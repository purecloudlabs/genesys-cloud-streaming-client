var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _this = this;
var client;
var button = document.createElement('button');
button.onclick = function () {
    var _a, _b, _c, _d, _e;
    console.log('button clicked, going to send message');
    var barejid = (_c = (_b = (_a = client.activeStanzaInstance) === null || _a === void 0 ? void 0 : _a.jid) === null || _b === void 0 ? void 0 : _b.match(/(.+\.com)/)) === null || _c === void 0 ? void 0 : _c[1];
    var message = {
        to: barejid,
        from: (_d = client.activeStanzaInstance) === null || _d === void 0 ? void 0 : _d.jid,
        mediaMessage: { id: '123', method: 'headsetControlsRequest', params: { requestType: 'mediaHelper' } }
    };
    (_e = client.activeStanzaInstance) === null || _e === void 0 ? void 0 : _e.sendMessage(message);
};
button.textContent = 'Send message';
document.body.appendChild(button);
var button2 = document.createElement('button');
button2.textContent = 'Invalidate token';
button2.onclick = function () { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log('button clicked, invalidating auth token');
                client.setAccessToken('');
                return [4 /*yield*/, client.disconnect()];
            case 1:
                _a.sent();
                client.connect({ keepTryingOnFailure: true });
                return [2 /*return*/];
        }
    });
}); };
document.body.appendChild(button2);
var authButon = document.createElement('button');
authButon.textContent = 'Set auth token';
authButon.onclick = function () {
    var input = document.querySelector('input');
    var token = input === null || input === void 0 ? void 0 : input.value;
    console.log('auth token', token);
    window.scConfig = {
        authToken: token,
        host: 'wss://streaming.inindca.com',
        optOutOfWebrtcStatsTelemetry: true
    };
    client = new window.GenesysCloudStreamingClient(window.scConfig);
    console.log('client');
    window.client = client;
    client.connect({ keepTryingOnFailure: true })
        .then(function () {
        console.log('Client connected 1');
    });
    // client.on('error', (error) => {
    //   console.log('RECEIVED Streaming Client Error!!!!', error);
    // });
};
document.body.appendChild(authButon);
var authInput = document.createElement('input');
authInput.type = 'text';
document.body.appendChild(authInput);
var clearAccessTokenBtn = document.createElement('button');
clearAccessTokenBtn.textContent = 'Clear access token';
clearAccessTokenBtn.onclick = function () {
    window.client.setAccessToken('');
};
document.body.appendChild(clearAccessTokenBtn);
var disconnect = document.createElement('button');
disconnect.textContent = 'Disconnect';
disconnect.onclick = function () {
    window.client.disconnect();
};
document.body.appendChild(disconnect);
