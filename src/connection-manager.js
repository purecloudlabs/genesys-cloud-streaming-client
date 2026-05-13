"use strict";
// so the idea here is any time stanza gets disconnected, we are effectively going to kill that instance of
// stanza and never reuse it. We may reuse the config for a given stanza client, but every connection attempt
// will merit its own brand new client. The purpose of this is because the stanza.connect() is not transactional
// and failed connection attempts trigger `disconnect` events either by timeout or some actual error. This is
// a problem because it effectively means we can get multiple disconnect events for a single connection attempt
// which makes trying to reconnect a stanza instance an tricky endeavor because we don't know if a disconnect
// event applies to a past connection attempt or if it applies to the most recent connection attempt. For this
// reason, we want a vanilla instance of stanza every time we call `connect` so wires don't get crossed.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionManager = void 0;
const tslib_1 = require("tslib");
const stanza_1 = require("stanza");
const uuid_1 = require("uuid");
const sasl_error_1 = tslib_1.__importDefault(require("./types/sasl-error"));
const utils_1 = require("./utils");
class ConnectionManager {
    constructor(logger, config) {
        this.logger = logger;
        this.config = config;
    }
    setConfig(config) {
        this.config = config;
    }
    async getNewStanzaConnection() {
        const options = this.getStanzaOptions();
        const stanza = (0, stanza_1.createClient)({});
        this.currentStanzaInstance = stanza;
        // this is a hack because stanza messes up the auth mechanism priority.
        stanza.sasl.mechanisms.find(mech => mech.name === 'ANONYMOUS').priority = 0;
        stanza.sasl.mechanisms = stanza.sasl.mechanisms.sort((a, b) => b.priority - a.priority);
        // we are going to give the stanza instance an id for tracking and logging purposes
        stanza.id = (0, uuid_1.v4)();
        const channelId = stanza.channelId = this.config.channelId;
        let boundCheckForErrorStanza;
        let boundSessionStarted;
        let boundSessionSasl;
        let boundSessionDisconnected;
        const connectionAttemptPromise = (0, utils_1.timeoutPromise)((resolve, reject) => {
            boundCheckForErrorStanza = this.checkForErrorStanza.bind(this, stanza);
            stanza.on('raw:incoming', boundCheckForErrorStanza);
            boundSessionStarted = this.handleSessionStarted.bind(this, stanza, resolve);
            stanza.on('session:started', boundSessionStarted);
            boundSessionSasl = this.handleSessionSasl.bind(this, stanza, reject);
            stanza.on('sasl', boundSessionSasl);
            boundSessionDisconnected = this.handleSessionDisconnected.bind(this, stanza, reject);
            stanza.on('disconnected', boundSessionDisconnected);
            stanza.updateConfig(options);
            stanza.connect();
        }, 15 * 1000, 'connecting to streaming service', { channelId, stanzaInstanceId: stanza.id });
        connectionAttemptPromise.catch(() => stanza.disconnect());
        return connectionAttemptPromise.finally(() => {
            stanza.off('raw:incoming', boundCheckForErrorStanza);
            stanza.off('session:started', boundSessionStarted);
            stanza.off('sasl', boundSessionSasl);
            stanza.off('disconnected', boundSessionDisconnected);
        });
    }
    handleSessionStarted(stanza, resolve) {
        this.logger.info('new stanza instance connected', { stanzaInstanceId: stanza.id, channelId: stanza.channelId });
        resolve(stanza);
    }
    handleSessionSasl(stanza, reject, sasl) {
        if (sasl.type === 'failure') {
            reject(new sasl_error_1.default(sasl.condition, stanza.channelId, stanza.id));
        }
    }
    handleSessionDisconnected(stanza, reject) {
        this.logger.error('stanza disconnected', { stanzaInstanceId: stanza.id, channelId: stanza.channelId });
        reject();
    }
    checkForErrorStanza(stanza, rawStanza) {
        if (rawStanza.includes('error')) {
            this.logger.error('Received a stanza during setup that tripped the error filter', { rawStanza, stanzaInstanceId: stanza.id, channelId: stanza.channelId });
        }
    }
    getStanzaOptions() {
        if (this.config.jwt) {
            return this.getJwtOptions();
        }
        return this.getStandardOptions();
    }
    getJwtOptions() {
        const config = this.config;
        const jwt = (0, utils_1.parseJwt)(config.jwt);
        let jidDomain;
        const jwtJid = jwt.data.jid;
        try {
            jidDomain = jwtJid.split('@')[1].replace('conference.', '');
        }
        catch (e) {
            throw new Error('failed to parse jid');
        }
        const wsHost = config.host.replace(/\/$/, '');
        return {
            resource: config.jidResource,
            transports: {
                websocket: `${wsHost}/stream/jwt/${config.jwt}`
            },
            server: jidDomain
        };
    }
    getStandardOptions() {
        const config = this.config;
        const wsHost = config.host.replace(/\/$/, '');
        return {
            jid: config.jid,
            resource: config.jidResource,
            credentials: {
                username: config.jid,
                password: `authKey:${config.authToken}`
            },
            transports: {
                websocket: `${wsHost}/stream/channels/${config.channelId}`
            }
        };
    }
}
exports.ConnectionManager = ConnectionManager;
