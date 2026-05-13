"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenesysCloudMediaSession = void 0;
const tslib_1 = require("tslib");
const webrtc_stats_gatherer_1 = tslib_1.__importDefault(require("webrtc-stats-gatherer"));
const events_1 = require("events");
const uuid_1 = require("uuid");
const utils_1 = require("../utils");
const interfaces_1 = require("./interfaces");
const loggingOverrides = {
    'Discovered new ICE candidate': { skipMessage: true }
};
class GenesysCloudMediaSession {
    constructor(webrtcExtension, params) {
        this.webrtcExtension = webrtcExtension;
        this.iceCandidatesDiscovered = 0;
        this.iceCandidatesReceivedFromPeer = 0;
        this.state = 'pending';
        this.connectionState = 'starting';
        this.id = params.id;
        this.fromJid = params.fromJid;
        this.peerID = params.peerID;
        this.logger = params.logger;
        this.conversationId = params.conversationId;
        this.fromUserId = params.fromUserId;
        this.pc = this.peerConnection = new RTCPeerConnection({
            iceServers: params.iceServers,
            iceTransportPolicy: params.iceTransportPolicy
        });
        this.originalRoomJid = params.originalRoomJid;
        this.sessionType = interfaces_1.SessionTypes[params.sessionType];
        this.ignoreHostCandidatesFromRemote = !!params.ignoreHostCandidatesFromRemote;
        this.allowIPv6 = !!params.allowIPv6;
        this.allowTCP = !!params.allowTCP;
        this.reinvite = !!params.reinvite;
        this.privAnswerMode = params.privAnswerMode;
        this.meetingId = params.meetingId;
        // babel does not like the typescript recipe for multiple extends so we are hacking this one
        // referencing https://github.com/babel/babel/issues/798
        const eventEmitter = new events_1.EventEmitter();
        Object.keys(eventEmitter.__proto__).forEach((name) => {
            this[name] = eventEmitter[name];
        });
        if (!params.optOutOfWebrtcStatsTelemetry) {
            this.setupStatsGatherer();
        }
        this.peerConnection.addEventListener('icecandidate', this.onIceCandidate.bind(this));
        this.peerConnection.addEventListener('iceconnectionstatechange', this.onIceStateChange.bind(this));
        this.peerConnection.addEventListener('connectionstatechange', this.onConnectionStateChange.bind(this));
        this.peerConnection.addEventListener('icecandidateerror', this.onIceCandidateError.bind(this));
        // sync the session state after a silent disconnect, like putting the system to sleep.
    }
    keepStateInSyncWithPeerConnection() {
        if (this.stateSyncTimeout) {
            clearTimeout(this.stateSyncTimeout);
            this.stateSyncTimeout = undefined;
        }
        const lastTime = Date.now();
        const checkInterval = 2000;
        const threshold = 2000;
        this.stateSyncTimeout = setTimeout(() => {
            const currentTime = Date.now();
            const timeDiff = currentTime - lastTime;
            if (timeDiff > checkInterval + threshold) {
                this.log('warn', 'MediaSession detected timer anomally. Reasons include taxed resources or system sleep.');
                // if we have a state mismatch
                if (this.state !== 'ended' && ['failed', 'closed'].includes(this.peerConnection.connectionState)) {
                    this.log('warn', 'state mismatch between session.state and peerConnection.connectionState, manually terminating the session', { sessionId: this.id, conversationId: this.conversationId, sessionType: this.sessionType });
                    this.onSessionTerminate();
                }
            }
            if (this.state !== 'ended') {
                this.keepStateInSyncWithPeerConnection();
            }
        }, checkInterval);
    }
    async setRemoteDescription(sdp) {
        return this.peerConnection.setRemoteDescription({ sdp, type: 'offer' });
    }
    getLogDetails() {
        return {
            conversationId: this.conversationId,
            sessionId: this.id,
            sessionType: this.sessionType
        };
    }
    log(level, message, details, options) {
        if (!details) {
            details = {};
        }
        const logDetails = { ...details, ...this.getLogDetails() };
        this.logger[level](message, logDetails, options);
    }
    async sendGenesysWebrtc(info) {
        info.id = info.id || (0, uuid_1.v4)();
        info.jsonrpc = info.jsonrpc || '2.0';
        const iq = {
            type: 'set',
            genesysWebrtc: info,
            from: this.webrtcExtension.jid,
            to: this.peerID
        };
        return this.webrtcExtension.sendIq(iq);
    }
    async end(reason = 'success', silent = false) {
        this.state = 'ended';
        const params = {
            sessionId: this.id,
            reason: reason.condition || reason
        };
        if (!silent) {
            await (0, utils_1.timeoutPromise)((resolve, reject) => {
                this.log('info', 'sending sdp terminate');
                this.sendGenesysWebrtc({ jsonrpc: '2.0', method: 'terminate', params }).then(resolve, reject);
            }, 2000, 'Timeout waiting for response to termination request', { sessionId: this.id, conversationId: this.conversationId, sessionType: this.sessionType }).catch((e) => this.logger.error(e));
        }
        this.onSessionTerminate(params.reason);
    }
    setupStatsGatherer() {
        this.statsGatherer = new webrtc_stats_gatherer_1.default(this.peerConnection);
        this.statsGatherer.on('stats', this.emit.bind(this, 'stats'));
    }
    async onIceStateChange() {
        const iceState = this.peerConnection.iceConnectionState;
        const sessionId = this.id;
        const conversationId = this.conversationId;
        const sessionType = this.sessionType;
        this.log('info', 'ICE state changed: ', { iceState, sessionId, conversationId });
        if (iceState === 'disconnected') {
            // this means we actually connected at one point
            if (this.peerConnection.signalingState === 'stable') {
                this.interruptionStart = new Date();
                this.log('info', 'Connection state is interrupted', { sessionId, conversationId, sessionType });
            }
        }
        else if (iceState === 'connected') {
            this.log('info', 'sending session-info: active');
            const params = {
                sessionId: this.id,
                status: 'active'
            };
            await this.sendGenesysWebrtc({
                jsonrpc: '2.0',
                params,
                method: 'info'
            });
            this._setupDataChannel();
        }
        else if (iceState === 'failed') {
            this.log('info', 'ICE connection failed', {
                candidatesDiscovered: this.iceCandidatesDiscovered,
                candidatesReceivedFromPeer: this.iceCandidatesReceivedFromPeer
            });
        }
    }
    onConnectionStateChange() {
        const connectionState = this.connectionState = this.peerConnection.connectionState;
        const sessionId = this.id;
        const conversationId = this.conversationId;
        const sessionType = this.sessionType;
        if (connectionState === 'connected') {
            this.keepStateInSyncWithPeerConnection();
        }
        this.log('info', 'Connection state changed: ', { connectionState, sessionId, conversationId, sessionType });
        if (this.interruptionStart) {
            if (connectionState === 'connected') {
                const diff = new Date().getTime() - this.interruptionStart.getTime();
                this.log('info', 'Connection was interrupted but was successfully recovered/connected', { sessionId, conversationId, sessionType, timeToRecover: diff });
                this.interruptionStart = undefined;
            }
            else if (connectionState === 'failed') {
                this.log('info', 'Connection was interrupted and failed to recover, cleaning up', { sessionId, conversationId, sessionType });
                this.onSessionTerminate();
            }
        }
        this.emit('connectionState', connectionState);
    }
    onIceCandidateError(ev) {
        const event = ev;
        this.log('error', 'IceCandidateError', {
            errorCode: event.errorCode,
            errorText: event.errorText,
            url: event.url
        });
    }
    /* istanbul ignore next */
    createIceCandidate(sdpMid, candidateStr) {
        return new RTCIceCandidate({
            sdpMid,
            candidate: candidateStr
        });
    }
    async addRemoteIceCandidate(sdpFragment) {
        // matches the mline type. example: "m=video 9 RTP/AVP 0" should result in "video"
        const sdpMid = sdpFragment.match(/m=([^\s]+)/)[1];
        // matches the entire a= line without the "a="
        const candidate = sdpFragment.match(/a=([^\\\r]+)/)[1];
        const iceCandidate = this.createIceCandidate(sdpMid, candidate);
        await this.peerConnection.addIceCandidate(iceCandidate);
    }
    // this is for ice candidates we harvest for ourself
    onIceCandidate(e) {
        var _a, _b;
        const candidateString = (_a = e.candidate) === null || _a === void 0 ? void 0 : _a.candidate;
        const sdpMid = (_b = e.candidate) === null || _b === void 0 ? void 0 : _b.sdpMid;
        let sdpStr;
        if (e.candidate) {
            if (!this.allowTCP && e.candidate.protocol === 'tcp') {
                return;
            }
            if (!this.allowIPv6) {
                const addressRegex = /.+udp [^ ]+ ([^ ]+).*typ host/;
                const matches = addressRegex.exec(e.candidate.candidate);
                const ipv4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
                if (matches && !matches[1].match(ipv4Regex)) {
                    this.log('debug', 'Filtering out IPv6 candidate', e.candidate.candidate);
                    return;
                }
            }
            // this has too much information and can only be logged locally (debug)
            this.log('debug', 'Processing ice candidate', e.candidate);
            // this one is info level so it can go to the server
            this.log('info', 'Discovered ice candidate to send to peer', { type: e.candidate.type });
            this.iceCandidatesDiscovered++;
            // media team asked us to send the mline and prefix the candidate with "a="
            sdpStr = `m=${sdpMid} 9 RTP/AVP 0\r\na=${candidateString}\r\n`;
        }
        else {
            sdpStr = 'a=end-of-candidates\r\n';
            this.emit('endOfCandidates');
        }
        return this.sendGenesysWebrtc({
            jsonrpc: '2.0',
            method: 'iceCandidate',
            params: {
                sessionId: this.id,
                sdp: sdpStr
            }
        });
    }
    onSessionTerminate(reason) {
        this.state = 'ended';
        if (this.peerConnection) {
            this.peerConnection.close();
        }
        this.logger.info('emitting sdp media-session (terminate)');
        this.emit('terminated', { condition: reason || 'success' });
    }
    async addTrack(track, stream) {
        const availableTransceiver = this.peerConnection.getTransceivers().find((transceiver) => {
            var _a;
            return !transceiver.sender.track && ((_a = transceiver.receiver.track) === null || _a === void 0 ? void 0 : _a.kind) === track.kind;
        });
        if (availableTransceiver) {
            return availableTransceiver.sender.replaceTrack(track);
        }
        this.peerConnection.addTrack(track, stream);
    }
    _setupDataChannel() {
        var _a;
        // this shouldn't happen, but we shouldn't set the datachannel up more than once
        if (this.dataChannel) {
            return;
        }
        // do nothing if a datachannel wasn't offered
        if ((_a = this.peerConnection.remoteDescription) === null || _a === void 0 ? void 0 : _a.sdp.includes('webrtc-datachannel')) {
            this.log('info', 'creating data channel');
            this.dataChannel = this.peerConnection.createDataChannel('videoConferenceControl');
            this.dataChannel.addEventListener('open', () => {
                this.log('info', 'data channel opened');
            });
            this.dataChannel.addEventListener('message', this._handleDataChannelMessage.bind(this));
            this.dataChannel.addEventListener('close', () => {
                this.log('info', 'closing data channel');
            });
            this.dataChannel.addEventListener('error', (error) => {
                this.log('error', 'Error occurred with the data channel', error);
            });
        }
    }
    _handleDataChannelMessage(event) {
        try {
            const message = JSON.parse(event.data);
            this.emit('dataChannelMessage', message);
        }
        catch (e) {
            this.log('error', 'Failed to parse data channel message', { error: e });
        }
    }
    async accept() {
        this.state = 'active';
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        const params = {
            sdp: answer.sdp,
            sessionId: this.id
        };
        // Do not log the SDP payload to avoid logging sensitive information.
        this.logger.info('sending sdp answer', { sessionId: this.id, conversationId: this.conversationId });
        return this.sendGenesysWebrtc({
            jsonrpc: '2.0',
            method: 'answer',
            params
        });
    }
    async mute(userId, type) {
        const params = {
            sessionId: this.id,
            type
        };
        return this.sendGenesysWebrtc({
            jsonrpc: '2.0',
            method: 'mute',
            params
        });
    }
    async unmute(userId, type) {
        const params = {
            sessionId: this.id,
            type
        };
        return this.sendGenesysWebrtc({
            jsonrpc: '2.0',
            method: 'unmute',
            params
        });
    }
    /* istanbul ignore next */
    async removeTrack() {
        throw new Error('Not Implemented');
    }
    /* istanbul ignore next */
    async hold() {
        throw new Error('Not Implemented');
    }
    /* istanbul ignore next */
    async resume() {
        throw new Error('Not Implemented');
    }
    toString() {
        return {
            connectionState: this.connectionState,
            state: this.state,
            sessionType: this.sessionType,
            fromJid: this.fromJid,
            conversationId: this.conversationId,
            id: this.id,
            peerConnection: this.peerConnection
        };
    }
}
exports.GenesysCloudMediaSession = GenesysCloudMediaSession;
