"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertingLeaderExtension = void 0;
const tslib_1 = require("tslib");
const axios_1 = tslib_1.__importDefault(require("axios"));
const interfaces_1 = require("./types/interfaces");
const events_1 = require("events");
const utils_1 = require("./utils");
class AlertingLeaderExtension extends events_1.EventEmitter {
    constructor(client, options) {
        var _a;
        super();
        this.client = client;
        this.leaderStatus = {};
        this.alertableInteractionTypes = (_a = options.alertableInteractionTypes) !== null && _a !== void 0 ? _a : [];
    }
    handleStanzaInstanceChange(stanzaInstance) {
        var _a, _b;
        this.connectionId = (_b = (_a = stanzaInstance.transport) === null || _a === void 0 ? void 0 : _a.stream) === null || _b === void 0 ? void 0 : _b.id;
        this.setupAlertingLeader();
    }
    async setupAlertingLeader() {
        if (this.alertableInteractionTypes.length !== 0) {
            try {
                await this.subscribeToAlertingLeader();
                await this.markAsAlertable();
                await this.getAlertingLeader();
            }
            catch (err) {
                this.client.logger.warn('Failed to setup alerting leader; falling back to the default of acting as the alerting leader');
                // Fail 'open' so users don't miss calls
                this.leaderStatus = { voice: { alerting: true, configured: false } };
                this.emit('alertingLeaderChanged', this.leaderStatus);
            }
        }
    }
    async subscribeToAlertingLeader() {
        const topic = `v2.users.${this.client.config.userId}.alertingleader`;
        this.client.on(`notify:${topic}`, (event) => {
            var _a, _b;
            (_a = this.abortController) === null || _a === void 0 ? void 0 : _a.abort();
            if ((_b = event.eventBody) === null || _b === void 0 ? void 0 : _b.connectionId) {
                // We should alert if our connection is the alerting leader connection
                const alerting = event.eventBody.connectionId === this.connectionId;
                const clientType = event.eventBody.clientType;
                let voice = { alerting, configured: true };
                if (clientType) {
                    voice = { ...voice, clientType };
                }
                this.leaderStatus = { voice };
                this.emit('alertingLeaderChanged', this.leaderStatus);
            }
        });
        return this.client._notifications._subscribeInternal(topic);
    }
    async markAsAlertable() {
        const userId = this.client.config.userId;
        const connectionsRequestOptions = {
            method: 'patch',
            host: this.client.config.apiHost,
            authToken: this.client.config.authToken,
            logger: this.client.logger,
            data: {
                alertable: true
            }
        };
        // STREAM-1204
        // There's a race condition between the backend service knowing about the connection
        // and us marking the connection as alertable. For now, we'll just retry with some delay.
        const maxRetries = 16;
        let retryCount = 0;
        const retry = (0, utils_1.retryPromise)(() => this.client.http.requestApi(`apps/users/${userId}/connections/${this.connectionId}`, connectionsRequestOptions), () => {
            retryCount++;
            if (retryCount >= maxRetries) {
                this.client.logger.info('Max retries reached for marking connection as alertable');
                return false;
            }
            return true;
        }, 500, this.client.logger);
        return retry.promise
            .catch(() => {
            this.client.logger.warn('Could not mark this connection as alertable; this client may not alert for incoming interactions');
        });
    }
    async getAlertingLeader() {
        this.abortController = new AbortController();
        const leaderRequestOptions = {
            method: 'get',
            host: this.client.config.apiHost,
            authToken: this.client.config.authToken,
            logger: this.client.logger,
            signal: this.abortController.signal
        };
        try {
            const currentLeader = await this.client.http.requestApi('users/alertingleader', leaderRequestOptions);
            // We should alert if our connection is the alerting leader connection
            const alerting = currentLeader.data.connectionId === this.connectionId;
            const clientType = currentLeader.data.clientType;
            let voice = { alerting, configured: true };
            if (clientType) {
                voice = { ...voice, clientType };
            }
            this.leaderStatus = { voice };
            this.emit('alertingLeaderChanged', this.leaderStatus);
        }
        catch (err) {
            if (axios_1.default.isCancel(err)) {
                return;
            }
            throw err;
        }
    }
    async claimAlertingLeader() {
        if (this.alertableInteractionTypes.length === 0) {
            this.client.logger.info('This client is not configured for any alertable interactions and will not attempt to claim alerting leader');
            throw new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Unable to claim alerting leader; this client is not configured for any alertable interactions');
        }
        const leaderRequestOptions = {
            method: 'put',
            host: this.client.config.apiHost,
            authToken: this.client.config.authToken,
            logger: this.client.logger,
            data: {
                connectionId: this.connectionId
            }
        };
        return this.client.http.requestApi('users/alertingleader', leaderRequestOptions)
            .catch((err) => {
            this.client.logger.warn('Unable to claim alerting leader; this client may not alert for incoming interactions');
            throw new utils_1.StreamingClientError(interfaces_1.StreamingClientErrorTypes.generic, 'Unable to claim alerting leader', err);
        });
    }
    get expose() {
        return {
            on: this.on.bind(this),
            off: this.off.bind(this),
            claimAlertingLeader: this.claimAlertingLeader.bind(this),
            leaderStatus: this.leaderStatus
        };
    }
}
exports.AlertingLeaderExtension = AlertingLeaderExtension;
