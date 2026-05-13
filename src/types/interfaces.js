"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionTypes = exports.StreamingClientErrorTypes = exports.AlertableInteractionTypes = void 0;
var AlertableInteractionTypes;
(function (AlertableInteractionTypes) {
    AlertableInteractionTypes["voice"] = "voice";
})(AlertableInteractionTypes || (exports.AlertableInteractionTypes = AlertableInteractionTypes = {}));
var StreamingClientErrorTypes;
(function (StreamingClientErrorTypes) {
    StreamingClientErrorTypes["generic"] = "generic";
    StreamingClientErrorTypes["invalid_token"] = "invalid_token";
    StreamingClientErrorTypes["userCancelled"] = "user_cancelled";
})(StreamingClientErrorTypes || (exports.StreamingClientErrorTypes = StreamingClientErrorTypes = {}));
var SessionTypes;
(function (SessionTypes) {
    SessionTypes["softphone"] = "softphone";
    SessionTypes["collaborateVideo"] = "collaborateVideo";
    SessionTypes["acdScreenShare"] = "screenShare";
    SessionTypes["screenRecording"] = "screenRecording";
    SessionTypes["liveScreenMonitoring"] = "liveScreenMonitoring";
    SessionTypes["unknown"] = "unknown";
})(SessionTypes || (exports.SessionTypes = SessionTypes = {}));
