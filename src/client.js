'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const tslib_1 = require("tslib");
const limiter_1 = require("limiter");
const genesys_cloud_client_logger_1 = require("genesys-cloud-client-logger");
require("./polyfills");
const alerting_leader_1 = require("./alerting-leader");
const notifications_1 = require("./notifications");
const webrtc_1 = require("./webrtc");
const ping_1 = require("./ping");
const server_monitor_1 = require("./server-monitor");
const utils_1 = require("./utils");
const http_client_1 = require("./http-client");
const interfaces_1 = require("./types/interfaces");
const events_1 = tslib_1.__importDefault(require("events"));
const connection_manager_1 = require("./connection-manager");
const exponential_backoff_1 = require("exponential-backoff");
const sasl_error_1 = tslib_1.__importDefault(require("./types/sasl-error"));
const timeout_error_1 = require("./types/timeout-error");
const messenger_1 = require("./messenger");
const uuid_1 = require("uuid");
const connection_transfer_1 = require("./connection-transfer");
const user_cancelled_error_1 = tslib_1.__importDefault(require("./types/user-cancelled-error"));
const extensions = {
    notifications: notifications_1.Notifications,
    webrtcSessions: webrtc_1.WebrtcExtension,
    messenger: messenger_1.MessengerExtension,
    alertingLeader: alerting_leader_1.AlertingLeaderExtension
};
const STANZA_DISCONNECTED = 'stanzaDisconnected';
const NO_LONGER_SUBSCRIBED = 'notify:no_longer_subscribed';
const DUPLICATE_ID = 'notify:duplicate_id';
const MAX_CHANNEL_REUSES = 10;
const SESSION_STORE_KEY = 'sc_connectionData';
const BACKOFF_DECREASE_DELAY_MULTIPLIER = 5;
const INITIAL_DELAY = 2000;
class Client extends events_1.default {
    constructor(options) {
        super();
        this.connected = false;
        this.connecting = false;
        this.hardReconnectRequired = true;
        this.isGuest = false;
        this.backgroundAssistantMode = false;
        this.autoReconnect = true;
        this.cancelConnectionAttempt = false;
        this.extensions = [];
        this.channelReuses = 0;
        this.hasMadeInitialAttempt = false;
        this.jidResource = '';
        this.http = new http_client_1.HttpClient({ customHeaders: options.customHeaders });
        this.reconnectOnNoLongerSubscribed = options.reconnectOnNoLongerSubscribed !== false;
        this.useServerSidePings = options.useServerSidePings !== false;
        this.config = {
            host: options.host,
            apiHost: options.apiHost || options.host.replace('wss://streaming.', ''),
            authToken: options.authToken,
            jwt: options.jwt,
            jid: options.jid,
            jidResource: options.jidResource,
            channelId: null, // created on connect
            appName: options.appName,
            appVersion: options.appVersion,
            appId: options.appId,
            logLevel: options.logLevel,
            customHeaders: options.customHeaders
        };
        this.backgroundAssistantMode = this.checkIsBackgroundAssistant();
        this.isGuest = !this.backgroundAssistantMode && !options.authToken;
        let loggerAccessToken = options.authToken || '';
        let loggerUrl = `https://api.${this.config.apiHost}/api/v2/diagnostics/trace`;
        if (this.backgroundAssistantMode) {
            loggerAccessToken = options.jwt;
            loggerUrl += '/backgroundassistant';
        }
        this.logger = new genesys_cloud_client_logger_1.Logger({
            accessToken: loggerAccessToken,
            url: loggerUrl,
            uploadDebounceTime: 1000,
            initializeServerLogging: !this.isGuest && !options.optOutOfWebrtcStatsTelemetry,
            /* streaming-client logging info */
            appVersion: Client.version,
            appName: 'streaming-client',
            logLevel: this.config.logLevel || 'info',
            logger: options.logger || console,
            formatters: options.logFormatters,
            /* secondary/parent app info */
            originAppName: options.appName,
            originAppVersion: options.appVersion,
            originAppId: options.appId,
            customHeaders: options.customHeaders
        });
        this.connectionManager = new connection_manager_1.ConnectionManager(this.logger, this.config);
        Object.keys(extensions).forEach((extensionName) => {
            const extension = new extensions[extensionName](this, options);
            this.extensions.push(extension);
            if (!extension.tokenBucket) {
                // default rate limit
                // 20 stanzas per 1000 ms,
                // adding up to 25 stanzas over the course of the 1000ms
                // starting with 20 stanzas
                // = 45 stanzas max per 1000 ms
                // = 70 stanzas max per 2000 ms
                extension.tokenBucket = new limiter_1.TokenBucket(20, 25, 1000);
                extension.tokenBucket.content = 25;
            }
            if (typeof extension.on === 'function') {
                extension.on('send', this.handleSendEventFromExtension.bind(this, extension));
            }
            this[extensionName] = extension.expose;
            this[`_${extensionName}`] = extension;
        });
    }
    handleSendEventFromExtension(extension, data, message = false) {
        return extension.tokenBucket.removeTokens(1, () => {
            const stanza = this.activeStanzaInstance;
            if (!stanza) {
                return this.logger.warn('cannot send message, no active stanza client', { data, message }, { skipServer: true });
            }
            if (message === true) {
                return stanza.sendMessage(data);
            }
            return stanza.sendIQ(data);
        });
    }
    checkIsBackgroundAssistant() {
        if (this.config.jwt) {
            const jwt = (0, utils_1.parseJwt)(this.config.jwt);
            return jwt && jwt.iss === 'urn:purecloud:screenrecording';
        }
        return false;
    }
    addInateEventHandlers(stanza) {
        // make sure we don't stack event handlers. There should only ever be *at most* one handler
        this.removeStanzaBoundEventHandlers();
        this.boundStanzaDisconnect = this.handleStanzaDisconnectedEvent.bind(this, stanza);
        this.boundStanzaNoLongerSubscribed = this.handleNoLongerSubscribed.bind(this, stanza);
        this.boundStanzaDuplicateId = this.handleDuplicateId.bind(this, stanza);
        this.on(STANZA_DISCONNECTED, this.boundStanzaDisconnect);
        this.on(NO_LONGER_SUBSCRIBED, this.boundStanzaNoLongerSubscribed);
        this.on(DUPLICATE_ID, this.boundStanzaDuplicateId);
        this.extensions.forEach(extension => {
            if (typeof extension.handleIq === 'function') {
                stanza.on('iq', extension.handleIq.bind(extension));
            }
            if (typeof extension.handleMessage === 'function') {
                stanza.on('message', extension.handleMessage.bind(extension));
            }
        });
    }
    removeStanzaBoundEventHandlers() {
        if (this.boundStanzaDisconnect) {
            this.off(STANZA_DISCONNECTED, this.boundStanzaDisconnect);
            this.boundStanzaDisconnect = undefined;
        }
        if (this.boundStanzaNoLongerSubscribed) {
            this.off(NO_LONGER_SUBSCRIBED, this.boundStanzaNoLongerSubscribed);
            this.boundStanzaNoLongerSubscribed = undefined;
        }
        if (this.boundStanzaDuplicateId) {
            this.off(DUPLICATE_ID, this.boundStanzaDuplicateId);
            this.boundStanzaDuplicateId = undefined;
        }
    }
    proxyStanzaEvents(stanza) {
        stanza.originalEmitter = stanza.emit;
        stanza.emit = (eventName, ...args) => {
            const hasListeners = stanza.originalEmitter(eventName, ...args);
            // there are a few events that need to be handled specially. stanza emits a `connected` event
            // which means the web socket connected but that doesn't mean it's not going to immediately close.
            // For this reason, we are going to equate the `session:started` event as "connected" which
            // essentially means the websocket connection is stable.
            //
            // we are also going to let streaming client control its own connected and disconnected state so
            // we will emit those events separately "when we are ready".
            // as per block comment, we'll ignore the connected event
            if (eventName === 'connected') {
                return hasListeners;
            }
            else if (eventName === 'disconnected') {
                eventName = STANZA_DISCONNECTED;
            }
            return this.emit(eventName, ...args);
        };
    }
    async handleStanzaDisconnectedEvent(disconnectedInstance) {
        var _a, _b;
        this.logger.info('stanzaDisconnected event received', { stanzaInstanceId: disconnectedInstance.id, channelId: disconnectedInstance.channelId });
        this.connected = false;
        this.connecting = false;
        (_a = disconnectedInstance.pinger) === null || _a === void 0 ? void 0 : _a.stop();
        (_b = disconnectedInstance.serverMonitor) === null || _b === void 0 ? void 0 : _b.stop();
        this.removeAllListeners(STANZA_DISCONNECTED);
        this.removeAllListeners(NO_LONGER_SUBSCRIBED);
        // unproxy events
        if (disconnectedInstance.originalEmitter) {
            disconnectedInstance.emit = disconnectedInstance.originalEmitter;
        }
        this.activeStanzaInstance = undefined;
        this.emit('disconnected', { reconnecting: this.autoReconnect });
        if (this.autoReconnect) {
            return this.connect({ keepTryingOnFailure: true })
                .catch(error => {
                this.logger.error('Failed to auto reconnect', {
                    keepTryingOnFailure: true,
                    stanzaInstanceId: disconnectedInstance.id,
                    channelId: disconnectedInstance.channelId
                });
                this.emit('disconnected', {
                    error,
                    reconnecting: false
                });
            });
        }
    }
    handleNoLongerSubscribed(stanzaInstance) {
        var _a, _b;
        this.logger.warn('noLongerSubscribed event received', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
        (_a = stanzaInstance.pinger) === null || _a === void 0 ? void 0 : _a.stop();
        (_b = stanzaInstance.serverMonitor) === null || _b === void 0 ? void 0 : _b.stop();
        this.hardReconnectRequired = true;
        if (!this.reconnectOnNoLongerSubscribed) {
            this.autoReconnect = false;
        }
    }
    handleDuplicateId(stanzaInstance) {
        var _a, _b;
        this.logger.warn('duplicate_id event received, forcing hard reconnect', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
        (_a = stanzaInstance.pinger) === null || _a === void 0 ? void 0 : _a.stop();
        (_b = stanzaInstance.serverMonitor) === null || _b === void 0 ? void 0 : _b.stop();
        this.hardReconnectRequired = true;
    }
    async disconnect() {
        this.logger.info('streamingClient.disconnect was called');
        // Clear stored JID on client disconnect.
        this.jidResource = '';
        return (0, utils_1.timeoutPromise)(resolve => {
            this.hardReconnectRequired = true;
            this.autoReconnect = false;
            this.cancelConnectionAttempt = true;
            this.http.stopAllRetries();
            const currentStanza = this.connectionManager.currentStanzaInstance;
            if (currentStanza) {
                return currentStanza.disconnect().then(resolve);
            }
            else {
                resolve();
            }
        }, 5000, 'disconnecting streaming service');
    }
    getSessionStoreKey() {
        const differentiator = this.config.appName || this.logger.clientId;
        return `${SESSION_STORE_KEY}_${differentiator}`;
    }
    getConnectionData() {
        const connectionDataStr = sessionStorage.getItem(this.getSessionStoreKey());
        const defaultValue = {
            currentDelayMs: 0
        };
        if (connectionDataStr) {
            try {
                return JSON.parse(connectionDataStr);
            }
            catch (e) {
                this.logger.warn('failed to parse streaming client connection data');
                return defaultValue;
            }
        }
        return defaultValue;
    }
    setConnectionData(data) {
        sessionStorage.setItem(this.getSessionStoreKey(), JSON.stringify(data));
    }
    increaseBackoff() {
        const connectionData = this.getConnectionData();
        const currentDelay = Math.max(connectionData.currentDelayMs * 2, INITIAL_DELAY * 2);
        const newConnectionData = {
            currentDelayMs: currentDelay,
            delayMsAfterNextReduction: currentDelay / 2,
            nextDelayReductionTime: new Date().getTime() + (currentDelay * BACKOFF_DECREASE_DELAY_MULTIPLIER),
            timeOfTotalReset: new Date().getTime() + 1000 * 60 * 60 // one hour in the future
        };
        this.setConnectionData(newConnectionData);
        return newConnectionData;
    }
    decreaseBackoff(newAmountMs) {
        const data = this.getConnectionData();
        const msUntilNextReduction = newAmountMs * BACKOFF_DECREASE_DELAY_MULTIPLIER;
        const newConnectionData = {
            currentDelayMs: newAmountMs,
            delayMsAfterNextReduction: newAmountMs / 2,
            nextDelayReductionTime: new Date().getTime() + (msUntilNextReduction),
            timeOfTotalReset: data.timeOfTotalReset
        };
        // if we are past the total reset time, do that instead
        if (data.timeOfTotalReset && data.timeOfTotalReset < new Date().getTime() || newAmountMs < INITIAL_DELAY) {
            this.logger.debug('decreaseBackoff() called, but timeOfTotalReset has elasped or next delay is below 2s. Resetting backoff');
            return this.setConnectionData({
                currentDelayMs: 0
            });
        }
        this.setConnectionData(newConnectionData);
        clearTimeout(this.backoffReductionTimer);
        this.logger.debug('Setting timer for next backoff reduction since we haven\'t reached total reset', { msUntilReduction: msUntilNextReduction, delayMsAfterNextReduction: newConnectionData.delayMsAfterNextReduction });
        this.backoffReductionTimer = setTimeout(() => this.decreaseBackoff(newConnectionData.delayMsAfterNextReduction), msUntilNextReduction);
    }
    getStartingDelay(connectionData, maxDelay) {
        // we don't want the delay to ever be less than 2 seconds
        const minDelay = Math.max(connectionData.currentDelayMs, INITIAL_DELAY);
        if (connectionData.timeOfTotalReset && connectionData.timeOfTotalReset < new Date().getTime()) {
            return INITIAL_DELAY;
        }
        return Math.min(minDelay, maxDelay);
    }
    async connect(connectOpts) {
        var _a;
        this.cancelConnectionAttempt = false;
        if (this.connecting) {
            const error = new Error('Already trying to connect streaming client');
            return this.logger.warn(error);
        }
        this.connecting = true;
        const maxDelay = (connectOpts === null || connectOpts === void 0 ? void 0 : connectOpts.maxDelayBetweenConnectionAttempts) || 90000;
        let maxAttempts = (connectOpts === null || connectOpts === void 0 ? void 0 : connectOpts.maxConnectionAttempts) || 1;
        if (connectOpts === null || connectOpts === void 0 ? void 0 : connectOpts.keepTryingOnFailure) {
            // this maintains the previous functionality
            maxAttempts = Infinity;
        }
        clearTimeout(this.backoffReductionTimer);
        const connectionData = this.getConnectionData();
        const startingDelay = this.getStartingDelay(connectionData, maxDelay);
        const delayFirstAttempt = this.hasMadeInitialAttempt;
        this.hasMadeInitialAttempt = true;
        if (connectionData.currentDelayMs) {
            this.logger.debug('streamingClient.connect was called, but backoff is remembered', { currentDelayMs: connectionData.currentDelayMs, delayingThisAttempt: delayFirstAttempt, clientId: this.logger.clientId, appName: this.config.appName });
        }
        try {
            await (0, exponential_backoff_1.backOff)(async () => {
                const connectionData = this.getConnectionData();
                await this.makeConnectionAttempt();
                if (connectionData.nextDelayReductionTime) {
                    const msUntilReduction = connectionData.nextDelayReductionTime - new Date().getTime();
                    this.logger.debug('Setting timer for next backoff reduction', { msUntilReduction, delayMsAfterNextReduction: connectionData.delayMsAfterNextReduction });
                    this.backoffReductionTimer = setTimeout(() => this.decreaseBackoff(connectionData.delayMsAfterNextReduction || 0), msUntilReduction);
                }
            }, {
                jitter: 'none',
                maxDelay,
                numOfAttempts: maxAttempts,
                startingDelay,
                delayFirstAttempt,
                retry: this.backoffConnectRetryHandler.bind(this, {
                    maxConnectionAttempts: maxAttempts
                })
            });
        }
        catch (err) {
            let errorForThrowing;
            let errorForLogging = err;
            // Check `cancelConnectionAttempt` instead of the error type in case a different error occurred
            // around the same time that might mask the cancellation.
            if (this.cancelConnectionAttempt) {
                errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.userCancelled, 'Streaming client connection cancelled', err);
                errorForLogging = errorForThrowing;
            }
            else if (!err) {
                errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Streaming client connection attempted and received an undefined error');
                errorForLogging = errorForThrowing;
            }
            else if (err.name === 'AxiosError') {
                const axiosError = err;
                const config = axiosError.config || { url: undefined, method: undefined };
                // sanitized error for logging
                errorForLogging = {
                    config: {
                        url: config.url,
                        method: config.method
                    },
                    status: (_a = axiosError.response) === null || _a === void 0 ? void 0 : _a.status,
                    code: axiosError.code,
                    name: axiosError.name,
                    message: axiosError.message
                };
                errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Failed to connect streaming client due to network error', err);
                if (this.networkErrorNeedsAuth(err)) {
                    errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.invalid_token, 'Failed to connect streaming client due to invalid token', err);
                }
            }
            else if (err instanceof sasl_error_1.default) {
                errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.invalid_token, 'Failed to connect streaming client due to invalid token', err);
                if (this.saslErrorIsRetryable(err)) {
                    errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Streaming client connection attempted and received a SASL error', err);
                }
            }
            else {
                errorForThrowing = new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Streaming client connection attempted and received an unknown error', err);
            }
            this.logger.error('Failed to connect streaming client', { error: errorForLogging });
            throw errorForThrowing;
        }
    }
    async backoffConnectRetryHandler(connectOpts, err, connectionAttempt) {
        var _a, _b, _c, _d;
        // Check `cancelConnectionAttempt` instead of the error type in case a different error occurred
        // around the same time that might allow for retries to continue.
        if (this.cancelConnectionAttempt) {
            return false;
        }
        // if we exceed the `numOfAttempts` in the backoff config it still calls this retry fn and just ignores the result
        // if that's the case, we just want to bail out and ignore all the extra logging here.
        if (connectionAttempt >= connectOpts.maxConnectionAttempts) {
            return false;
        }
        const additionalErrorDetails = { connectionAttempt, error: err };
        if (!err) {
            additionalErrorDetails.error = new Error('streaming client backoff handler received undefined error');
        }
        else if (err.name === 'AxiosError') {
            const axiosError = err;
            const config = axiosError.config || { url: undefined, method: undefined };
            const sanitizedError = {
                config: {
                    url: config.url,
                    method: config.method
                },
                status: (_a = axiosError.response) === null || _a === void 0 ? void 0 : _a.status,
                code: axiosError.code,
                name: axiosError.name,
                message: axiosError.message
            };
            additionalErrorDetails.error = sanitizedError;
            if (this.networkErrorNeedsAuth(err)) {
                this.logger.error('Streaming client received an error that it can\'t recover from and will not attempt to reconnect', additionalErrorDetails);
                return false;
            }
        }
        // If we get a sasl error, that means we made it all the way to the point of trying to open a websocket and
        // it was rejected for some reason. Some errors might resolve if we try connecting again. Others need
        // re-authentication.
        if (err instanceof sasl_error_1.default) {
            if (this.saslErrorIsRetryable(err)) {
                this.logger.info('hardReconnectRequired set to true due to sasl error');
                this.hardReconnectRequired = true;
                Object.assign(additionalErrorDetails, { channelId: err.channelId, stanzaInstanceId: err.stanzaInstanceId });
            }
            else {
                additionalErrorDetails.error = err.condition;
                this.logger.error('Streaming-client received a SASL error that it can\'t recover from and will not attempt to reconnect', additionalErrorDetails);
                return false;
            }
        }
        // we don't need to log the stack for a timeout message
        if (err instanceof timeout_error_1.TimeoutError) {
            additionalErrorDetails.error = err.message;
            const details = err.details;
            if (details) {
                additionalErrorDetails.details = details;
            }
        }
        if (err === null || err === void 0 ? void 0 : err.response) {
            // This *should* be an axios error according to typings, but it appears this could be an AxiosError *or* and XmlHttpRequest
            // we'll check both to be safe
            const retryAfter = ((_b = err.response.headers) === null || _b === void 0 ? void 0 : _b['retry-after']) || ((_d = (_c = err.response).getResponseHeader) === null || _d === void 0 ? void 0 : _d.call(_c, 'retry-after'));
            if (retryAfter) {
                // retry after comes in seconds, we need to return milliseconds
                const retryDelay = parseInt(retryAfter, 10) * 1000;
                additionalErrorDetails.retryDelay = retryDelay;
                this.logger.error('Failed streaming client connection attempt, respecting retry-after header and will retry afterwards.', additionalErrorDetails);
                await (0, utils_1.delay)(retryDelay);
                this.logger.debug('finished waiting for retry-after');
                return true;
            }
        }
        const connectionData = this.increaseBackoff();
        this.logger.error('Failed streaming client connection attempt, retrying', additionalErrorDetails);
        this.logger.debug('debug: retry info', { expectedRetryInMs: connectionData.currentDelayMs, appName: this.config.appName, clientId: this.logger.clientId });
        return true;
    }
    networkErrorNeedsAuth(error) {
        var _a;
        return [401, 403].includes(((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) || 0);
    }
    saslErrorIsRetryable(error) {
        const retryConditions = ['encryption-required', 'incorrect-encoding', 'invalid-mechanism', 'malformed-request', 'mechanism-too-weak'];
        return retryConditions.includes(error.condition);
    }
    /**
     * Performs an active network connectivity check by querying the API.
     * navigator.onLine is unreliable (VPNs, virtual adapters, etc.), so we
     * actually reach out to verify we can talk to the server.
     *
     * Returns true if connectivity is confirmed, false otherwise.
     * This is advisory only — it does not gate connection attempts.
     */
    async checkNetworkConnectivity() {
        // Quick hint check first — if the browser says offline, that's a strong signal
        if (!navigator.onLine) {
            this.logger.warn('navigator.onLine reports offline — connectivity may be unavailable');
            this.emit('networkConnectivityWarning', { reason: 'navigator.onLine is false' });
            return false;
        }
        // JWT-based connections (e.g. background assistants) don't have an auth token
        // that works with the users/me endpoint, so we can only rely on navigator.onLine
        if (this.config.jwt && !this.config.authToken) {
            this.logger.debug('Skipping active connectivity check in JWT mode, relying on navigator.onLine');
            return true;
        }
        try {
            const opts = {
                method: 'get',
                host: this.config.apiHost,
                authToken: this.config.authToken,
                logger: this.logger,
                requestTimeout: 10000
            };
            await this.http.requestApi('users/me', opts);
            return true;
        }
        catch (err) {
            this.logger.warn('Active network connectivity check failed — connectivity may be unavailable', { error: err });
            this.emit('networkConnectivityWarning', { reason: 'active connectivity check failed', error: err });
            return false;
        }
    }
    async makeConnectionAttempt() {
        var _a, _b;
        if (this.cancelConnectionAttempt) {
            throw new user_cancelled_error_1.default('Connection attempt cancelled');
        }
        // navigator.onLine is unreliable — use it as a hint, not a gate.
        // Fire off an active connectivity check in the background. It will
        // log and emit warnings if there's an issue, but we don't wait for it.
        this.checkNetworkConnectivity().then(isConnected => {
            if (!isConnected) {
                this.logger.warn('Network connectivity check failed, but proceeding with connection attempt anyway');
            }
        });
        let stanzaInstance;
        const previousConnectingState = this.connecting;
        try {
            await this.prepareForConnect();
            if (this.cancelConnectionAttempt) {
                throw new user_cancelled_error_1.default('Connection attempt cancelled');
            }
            stanzaInstance = await this.connectionManager.getNewStanzaConnection();
            this.connected = true;
            this.connecting = false;
            this.addInateEventHandlers(stanzaInstance);
            this.proxyStanzaEvents(stanzaInstance);
            // handle any extension configuration
            for (const extension of this.extensions) {
                if (extension.configureNewStanzaInstance) {
                    await extension.configureNewStanzaInstance(stanzaInstance);
                }
            }
            for (const extension of this.extensions) {
                extension.handleStanzaInstanceChange(stanzaInstance);
            }
            this.activeStanzaInstance = stanzaInstance;
            await this.setupConnectionMonitoring(stanzaInstance);
            this.emit('connected');
        }
        catch (err) {
            if (stanzaInstance) {
                this.logger.error('Error occurred in connection attempt, but after websocket connected. Cleaning up connection so backoff is respected', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
                this.removeStanzaBoundEventHandlers();
                (_a = stanzaInstance.pinger) === null || _a === void 0 ? void 0 : _a.stop();
                (_b = stanzaInstance.serverMonitor) === null || _b === void 0 ? void 0 : _b.stop();
                await stanzaInstance.disconnect();
                this.connected = false;
                this.connecting = previousConnectingState;
            }
            throw err;
        }
    }
    async setupConnectionMonitoring(stanzaInstance) {
        stanzaInstance.connectionTransfer = new connection_transfer_1.ConnectionTransfer(this, stanzaInstance);
        const setupClientPinger = (message) => {
            const logMessage = `${message}, falling back to client-side pinging`;
            this.logger.warn(logMessage, { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
            stanzaInstance.pinger = new ping_1.Ping(this, stanzaInstance);
        };
        if (this.useServerSidePings) {
            try {
                // if this fails, then hawk doesn't support serverside pinging and we need to do client side pings
                await stanzaInstance.subscribeToNode(this._notifications.pubsubHost, 'enable.server.side.pings');
                stanzaInstance.serverMonitor = new server_monitor_1.ServerMonitor(this, stanzaInstance);
            }
            catch (err) {
                setupClientPinger('failed to establish server-side pinging');
            }
        }
        else {
            setupClientPinger('client configured to not use server-side pinging');
        }
    }
    async prepareForConnect() {
        if (this.config.jwt) {
            this.hardReconnectRequired = false;
            return this.connectionManager.setConfig(this.config);
        }
        if (!this.hardReconnectRequired) {
            this.channelReuses++;
            if (this.channelReuses >= MAX_CHANNEL_REUSES) {
                this.logger.warn('Forcing a hard reconnect due to max channel reuses', { channelId: this.config.channelId, channelReuses: this.channelReuses });
                this.channelReuses = 0;
                this.hardReconnectRequired = true;
            }
        }
        if (this.hardReconnectRequired) {
            let userPromise;
            if (this.config.userId && this.config.jid) {
                userPromise = Promise.resolve({ userId: this.config.userId, jid: this.config.jid });
            }
            else {
                const jidRequestOpts = {
                    method: 'get',
                    host: this.config.apiHost,
                    authToken: this.config.authToken,
                    logger: this.logger
                };
                userPromise = this.http.requestApi('users/me', jidRequestOpts)
                    .then(res => {
                    return {
                        userId: res.data.id,
                        jid: res.data.chat.jabberId
                    };
                });
            }
            // If no jidResource is provided, generate a random one to maintain ourselves.
            this.jidResource = this.config.jidResource || (0, uuid_1.v4)();
            const channelRequestOpts = {
                method: 'post',
                host: this.config.apiHost,
                authToken: this.config.authToken,
                logger: this.logger
            };
            const channelPromise = await this.http.requestApi('notifications/channels?connectionType=streaming', channelRequestOpts)
                .then(res => res.data.id);
            const [{ userId, jid }, channelId] = await Promise.all([userPromise, channelPromise]);
            this.config.userId = userId;
            this.config.jid = jid;
            this.config.jidResource = this.jidResource;
            this.config.channelId = channelId;
            this.autoReconnect = true;
            this.logger.info('attempting to connect streaming client on channel', { channelId });
            this.connectionManager.setConfig(this.config);
            this.hardReconnectRequired = false;
        }
    }
    stopServerLogging() {
        /* flush all pending logs – then turn off the logger */
        this.logger.sendAllLogsInstantly();
        this.logger.stopServerLogging();
    }
    startServerLogging() {
        this.logger.startServerLogging();
    }
    setAccessToken(token) {
        this.config.authToken = token;
        this.logger.setAccessToken(token);
    }
    static extend(namespace, extension) {
        if (extensions[namespace]) {
            throw new Error(`Cannot register already existing namespace ${namespace}`);
        }
        extensions[namespace] = extension;
    }
    get version() {
        return Client.version;
    }
    static get version() {
        return '__STREAMING_CLIENT_VERSION__';
    }
}
exports.Client = Client;
