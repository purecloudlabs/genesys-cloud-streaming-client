'use strict';
// const xmpp = require('node-xmpp-core');
const Jingle = require('jingle-purecloud');
const uuid = require('uuid');
// const _ = require('lodash');
const {TokenBucket} = require('limiter');

const MediaDataSession = require('jingle-media-data-session-purecloud');
const MediaSession = require('jingle-media-session-purecloud');

const log = {
  debug: console.log.bind(console),
  warn: console.warn.bind(console)
};

function __guard__ (value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}

function createSessionManager () {
  return new Jingle({
    iceServers: [],
    prepareSession (opts) {
      opts.signalEndOfCandidates = true;
            // conference rooms always use MediaSession
      if (opts.peerID.toString().indexOf('@conference') > -1) {
        const session = new MediaSession(opts);

              // set up the last-n datachannel
        session.on('addChannel', function (channel) {
          session.lastNChannel = channel;
          channel.onmessage = function (message) {
            if (__guard__(message, x => x.data)) {
              return session.emit('lastNChange', JSON.parse(message.data));
            }
          };
          return channel.onmessage;
        });
        return session;
      }

            // one to one rooms use MediaDataSession if datachannel is enabled
      if (Array.from(opts.applicationTypes).includes('rtp')) {
        if (Array.from(opts.applicationTypes).includes('datachannel')) {
          return new MediaDataSession(opts);
        } else {
          return new MediaSession(opts);
        }
      }
    }
  });
}

module.exports = function (stanzaio, options) {
  let pendingSessions = {};
  let pendingIqs = {};
  let emit = stanzaio.emit.bind(stanzaio);

  let bareJid = function () {
    return stanzaio.jid.bare;
  };

  let stanzaLimiter = new TokenBucket(20, 25, 1000);
  stanzaLimiter.content = 20;

  let sessionManager = createSessionManager();
  stanzaio.on('disconnect', () => {
    if (options.rtcSessionSurvivability !== true) {
      pendingSessions = {};
      pendingIqs = {};
      return sessionManager.endAllSessions('disconnect');
    }
  });

  sessionManager.on('send', data => {
    if (['get', 'set'].includes(data.type)) {
      data.id = uuid.v1();
      pendingIqs[data.id] = data;
    }

    return stanzaLimiter.removeTokens(1, () => {
      return stanzaio.sendIq(data);
    });
  });

  sessionManager.on('outgoing', session => {
    return emit('outgoingRtcSession', session);
  });

  sessionManager.on('incoming', session => {
    return emit('incomingRtcSession', session);
  });

  sessionManager.on('log:*', (level, msg) => {
    return emit('traceRtcSession', level.split(':')[1], msg);
  });

  sessionManager.on('error', req => {
    return emit('rtcSessionError', req.error, req);
  });

  stanzaio.on('iq:set:jingle', (stanza) => {
        // all return and error stanzas must match our pending sent iqs in order to be handled
    if (['result', 'error'].includes(stanza.type)) {
      const pendingIq = this.pendingIqs[stanza.id];
      if (pendingIq) {
            // Workaround for https://github.com/otalk/jingle.js/issues/34
        stanza.jingle = pendingIq.jingle;

        delete this.pendingIqs[stanza.id];
      } else {
        return;
      }
    }

    return this.sessionManager.process(stanza);
  });

    // TODO: Handle requestWebRtcDump
    // TODO: Handle jingle messages
    // TODO: Handle upgrade errors

  let handleEndRtcSessionsWithJid = function (jid, reason) {
    return Object.keys(sessionManager.peers).forEach((peerId) => {
      if (peerId.indexOf(jid) < 0) {
        return;
      }

      sessionManager.endPeerSessions(peerId, reason);
      return (() => {
        const result = [];
        for (let sessionId in pendingSessions) {
          let item;
          if (pendingSessions[sessionId].to === peerId) {
            item = delete pendingSessions[sessionId];
          }
          result.push(item);
        }
        return result;
      })();
    });
  };

  function createRtcSession (jid, sid, stream, peerConstraints, peerConnectionConstraints) {
    log.debug('video', 'startVideoChat', jid);

    peerConstraints = peerConstraints || { offerToReceiveAudio: true, offerToReceiveVideo: true };

    peerConnectionConstraints = peerConnectionConstraints || sessionManager.config.peerConnectionConstraints;

    try {
      let session;
      const opts = {
        sid,
        peer: jid,
        initiator: true,
        stream,
        parent: sessionManager,
        iceServers: sessionManager.iceServers,
        constraints: peerConnectionConstraints,
        signalEndOfCandidates: true
      };

      if (peerConstraints.offerToReceiveAudio || peerConstraints.offerToReceiveVideo) {
        session = new MediaDataSession(opts);
      } else {
        session = new MediaSession(opts);
      }

      sessionManager.addSession(session);

      return session.start(peerConstraints);
    } catch (err) {
      return emit('rtcSessionError', err);
    }
  }

  function endRtcSessions (opts, reason, callback) {
    if (!reason) { reason = 'success'; }
    if (!callback) { callback = function () {}; }
    if (typeof opts === 'function') {
      callback = opts;
      opts = { jid: null };
    } else if (typeof opts === 'string') {
      opts = { jid: opts };
    } else if (!opts) {
      opts = {};
    }

    if (typeof reason === 'function') {
      callback = reason;
      reason = 'success';
    }

    const jid = opts.jid || opts.oneToOneJid;

    if (jid) {
          // TODO: remove if-block after PCDWEBK-3533 (realtime and web-directory) has been merged and shipped to all environments
          // and after web-directory has removed their use of "oneToOneJid"
      if (opts.oneToOneJid) {
        log.warn('use of oneToOneJid with endRtcSessions is deprecated. please use "opts.jid"');
      }

      handleEndRtcSessionsWithJid(jid, reason);

      if (jid.match(/@conference/)) {
        emit('updateMediaPresence', {
          opts: {jid},
          mediaDescriptions: [],
          callback: callback
        });
      } else {
        return callback();
      }
    } else {
      sessionManager.endAllSessions(reason);
      pendingSessions = {};

      return callback(null);
    }
  }

  function leaveRtcSessions (jid, callback) {
    if (!callback) { callback = function () {}; }
    if (typeof jid === 'function') {
      callback = jid;
      jid = null;
    }

    return endRtcSessions({ jid }, 'success', callback);
  }

  function startRtcSession (jid, stream, callback) {
    if (!callback) { callback = function () {}; }
    return initiateRtcSession({ jid, stream }, callback);
  }

  function initiateRtcSession (opts, callback) {
    if (!callback) { callback = function () {}; }
    const session = {
      to: opts.jid,
      propose: {
        id: uuid.v1(),
        descriptions: []
      }
    };
    if (opts.stream) {
      for (let track of Array.from(opts.stream.getTracks())) {
        session.propose.descriptions.push({
          media: track.kind});
      }
    }

    if (opts.jid.match(/@conference/)) {
      let mediaDescriptions = session.propose.descriptions;
      if (mediaDescriptions.length === 0) {
        mediaDescriptions = [ { media: 'listener' } ];
      }
      emit('updateMediaPresence', {
        opts: opts,
        mediaDescriptions: mediaDescriptions,
        callback: callback
      });
    } else {
      stanzaio.sendMessage(session);
      pendingSessions[session.propose.id] = session;
      callback(null);
    }

    return session.propose.id;
  }

  function cancelRtcSession (sessionId) {
    const session = pendingSessions[sessionId];
    if (!session) {
      emit('rtcSessionError', 'Cannot cancel session because it is not pending or does not exist');
      return;
    }

    const message = {
      to: session.to,
      retract: {
        id: sessionId
      }
    };
    stanzaio.sendMessage(message);
    return delete pendingSessions[sessionId];
  }

  function acceptRtcSession (sessionId) {
    const session = pendingSessions[sessionId];
    if (!session) {
      emit('rtcSessionError', 'Cannot accept session because it is not pending or does not exist');
      return;
    }

    const accept = {
      to: bareJid().toString(),
      accept: {
        id: sessionId
      }
    };
    stanzaio.sendMessage(accept);

    const proceed = {
      to: session.from.toString(),
      proceed: {
        id: sessionId
      }
    };
    stanzaio.sendMessage(proceed);
    return delete pendingSessions[sessionId];
  }

  function rejectRtcSession (sessionId) {
    const session = pendingSessions[sessionId];
    if (!session) {
      emit('rtcSessionError', 'Cannot reject session because it is not pending or does not exist');
      return;
    }

    const reject = {
      to: bareJid().toString(),
      reject: {
        id: sessionId
      }
    };
    stanzaio.sendMessage(reject);

    reject.to = session.from.toString();
    stanzaio.sendMessage(reject);

    return delete pendingSessions[sessionId];
  }

  return {
    createRtcSession: createRtcSession,
    leaveRtcSessions: leaveRtcSessions,
    endRtcSessions: endRtcSessions,
    startRtcSession: startRtcSession,
    initiateRtcSession: initiateRtcSession,
    cancelRtcSession: cancelRtcSession,
    acceptRtcSession: acceptRtcSession,
    rejectRtcSession: rejectRtcSession
  };
};
