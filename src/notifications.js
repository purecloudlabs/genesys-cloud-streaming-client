"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notifications = void 0;
const tslib_1 = require("tslib");
const debounce_promise_1 = tslib_1.__importDefault(require("debounce-promise"));
const utils_1 = require("./utils");
const _1 = require("./");
const PUBSUB_HOST_DEFAULT = 'notifications.mypurecloud.com';
const MAX_SUBSCRIBABLE_TOPICS = 1000;
const DROPPED_TOPICS_DISPLAY_COUNT = 20;
const DEFAULT_PRIORITY = 0;
function mergeAndDedup(arr1, arr2) {
    return [...arr1, ...arr2].filter((t, i, arr) => arr.indexOf(t) === i);
}
class Notifications {
    constructor(client, options) {
        var _a;
        this.subscriptions = {};
        this.bulkSubscriptions = {};
        this.topicPriorities = {};
        this.internalSubscriptions = [];
        this.client = client;
        this.enablePartialBulkResubscribe = (_a = options === null || options === void 0 ? void 0 : options.enablePartialBulkResubscribe) !== null && _a !== void 0 ? _a : false;
        client.on('pubsub:event', this.pubsubEvent.bind(this));
        client.on('connected', this.subscriptionsKeepAlive.bind(this));
        this.debouncedResubscribe = (0, debounce_promise_1.default)(this.resubscribe.bind(this), 100);
    }
    get pubsubHost() {
        try {
            const host = this.client.config.apiHost.replace(/http(s?):\/\//, '');
            return `notifications.${host}`;
        }
        catch (e) {
            return PUBSUB_HOST_DEFAULT;
        }
    }
    handleStanzaInstanceChange(stanza) {
        // we need to resub if we go through a hard reconnect
        const needsToResub = this.stanzaInstance &&
            this.stanzaInstance.id !== stanza.id &&
            this.stanzaInstance.channelId !== stanza.channelId;
        this.stanzaInstance = stanza;
        if (needsToResub) {
            this.client.logger.info('resubscribing due to hard reconnect');
            this.debouncedResubscribe().catch((err) => {
                const msg = 'Error resubscribing to topics';
                this.client.logger.error(msg, err);
                this.client.emit('pubsub:error', { msg, err });
            });
        }
    }
    topicHandlers(topic) {
        if (!this.subscriptions[topic]) {
            this.subscriptions[topic] = [];
        }
        return this.subscriptions[topic];
    }
    pubsubEvent({ pubsub }) {
        let topic = pubsub.items.node;
        if (topic.includes('no_longer_subscribed')) {
            topic = 'no_longer_subscribed';
        }
        else if (topic.includes('duplicate_id')) {
            topic = 'duplicate_id';
        }
        const payload = pubsub.items.published[0].content.json;
        const handlers = this.topicHandlers(topic);
        this.client.emit('notify', { topic, data: payload });
        this.client.emit(`notify:${topic}`, payload);
        handlers.forEach((handler) => {
            handler(payload);
        });
    }
    async xmppSubscribe(topic) {
        if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
            return Promise.resolve();
        }
        const subscribe = () => this.stanzaInstance.subscribeToNode(this.pubsubHost, topic);
        if (this.client.connected) {
            return subscribe();
        }
        else {
            return new Promise((resolve, reject) => {
                this.client.once('connected', () => {
                    return subscribe().then(resolve, reject);
                });
            });
        }
    }
    xmppUnsubscribe(topic) {
        if (this.topicHandlers(topic).length !== 0 || this.bulkSubscriptions[topic]) {
            return Promise.resolve();
        }
        const unsubscribe = () => this.stanzaInstance.unsubscribeFromNode(this.pubsubHost, topic);
        if (this.client.connected) {
            return unsubscribe();
        }
        else {
            return new Promise((resolve, reject) => {
                this.client.once('connected', () => {
                    return unsubscribe().then(resolve, reject);
                });
            });
        }
    }
    mapCombineTopics(topics) {
        const prefixes = {};
        const precombinedTopics = [];
        const uncombinedTopics = [];
        topics.forEach(t => {
            if (t.includes('?')) {
                precombinedTopics.push({ id: t });
            }
            else {
                uncombinedTopics.push(t);
            }
        });
        uncombinedTopics.map(t => {
            const split = t.split('.');
            const postfix = split.splice(split.length - 1);
            const prefix = split.join('.');
            return { prefix, postfix };
        }).forEach(t => {
            if (prefixes[t.prefix]) {
                prefixes[t.prefix].push(t.postfix);
            }
            else {
                prefixes[t.prefix] = [t.postfix];
            }
        });
        const combinedTopics = [];
        // Max length of 200 in topic names
        // so recursively break them up if the combined length exceeds 200
        const combineTopics = (prefix, postFixes) => {
            const delimiter = postFixes.length === 1 ? '.' : '?';
            const id = `${prefix}${delimiter}${postFixes.join('&')}`;
            if (id.length < 200) {
                combinedTopics.push({ id });
            }
            else if (postFixes.length === 1) {
                this.client.logger.error('Refusing to attempt topic with length > 200', id);
            }
            else {
                combineTopics(prefix, postFixes.slice(0, postFixes.length / 2));
                combineTopics(prefix, postFixes.slice(postFixes.length / 2));
            }
        };
        Object.keys(prefixes).forEach(prefix => {
            const postFixes = prefixes[prefix];
            combineTopics(prefix, postFixes);
        });
        const allTopics = combinedTopics.concat(precombinedTopics);
        return this.truncateTopicList(this.prioritizeTopicList(allTopics));
    }
    prioritizeTopicList(topics) {
        topics.sort((topicA, topicB) => {
            return (this.getTopicPriority(topicB.id) - this.getTopicPriority(topicA.id));
        });
        return topics;
    }
    getTopicPriority(topic, returnDefault = true) {
        const { prefix, postfixes } = this.getTopicParts(topic);
        const oldPriorities = this.topicPriorities[prefix];
        const matches = oldPriorities && Object.keys(oldPriorities).filter(p => postfixes.includes(p)).map(p => oldPriorities[p]);
        const priority = matches && matches.length && matches.reduce((max, current) => current > max ? current : max);
        return returnDefault ? priority || DEFAULT_PRIORITY : priority;
    }
    truncateTopicList(topics) {
        const keptTopics = topics.slice(0, MAX_SUBSCRIBABLE_TOPICS);
        if (topics.length > MAX_SUBSCRIBABLE_TOPICS) {
            let droppedTopics = topics.slice(MAX_SUBSCRIBABLE_TOPICS);
            if (droppedTopics.length > DROPPED_TOPICS_DISPLAY_COUNT) {
                const length = droppedTopics.length - DROPPED_TOPICS_DISPLAY_COUNT;
                droppedTopics = droppedTopics.slice(DROPPED_TOPICS_DISPLAY_COUNT);
                droppedTopics.push(`...and ${length} more`);
            }
            this.client.logger.warn('Too many topics to subscribe to; truncating extra topics', { droppedTopics });
        }
        return keptTopics;
    }
    makeBulkSubscribeRequest(topics, options) {
        const requestOptions = {
            method: options.replace ? 'put' : 'post',
            host: this.client.config.apiHost,
            authToken: this.client.config.authToken,
            data: JSON.stringify(this.mapCombineTopics(topics)),
            logger: this.client.logger
        };
        const channelId = this.stanzaInstance.channelId;
        let path = `notifications/channels/${channelId}/subscriptions`;
        if (this.enablePartialBulkResubscribe) {
            path += '?ignoreErrors=true';
        }
        return this.client.http.requestApi(path, requestOptions);
    }
    createSubscription(topic, handler) {
        const topics = (0, utils_1.splitIntoIndividualTopics)(topic);
        topics.forEach(t => {
            const handlers = this.topicHandlers(t);
            if (!handlers.includes(handler)) {
                handlers.push(handler);
            }
        });
    }
    removeSubscription(topic, handler) {
        const topics = (0, utils_1.splitIntoIndividualTopics)(topic);
        topics.forEach(t => {
            const handlers = this.topicHandlers(t);
            const handlerIndex = handlers.indexOf(handler);
            if (handlerIndex > -1) {
                handlers.splice(handlerIndex, 1);
            }
            /* if we have removed all our individual handlers, we don't need the topic anymore
              (note: we aren't removing any bulkSubs if they exist for this topic) */
            if (!handlers.length) {
                delete this.subscriptions[t];
            }
        });
    }
    removeTopicPriority(topic) {
        if (this.getTopicPriority(topic, false)) {
            const { prefix, postfixes } = this.getTopicParts(topic);
            postfixes.forEach(postfix => {
                delete this.topicPriorities[prefix][postfix];
            });
            if (!Object.keys(this.topicPriorities[prefix]).length) {
                delete this.topicPriorities[prefix];
            }
        }
    }
    getActiveIndividualTopics() {
        const activeTopics = [];
        const topics = Object.keys(this.subscriptions);
        topics.forEach(topic => {
            if (topic === 'streaming-subscriptions-expiring') {
                return; // this doesn't need subscribed
            }
            const handlers = this.topicHandlers(topic);
            if (handlers.length > 0) {
                activeTopics.push(topic);
            }
        });
        return activeTopics;
    }
    resubscribe() {
        const bulkSubs = Object.keys(this.bulkSubscriptions);
        /* if we don't have bulk or individual subs, we don't need to resubscribe */
        const noTopics = bulkSubs.length + this.getActiveIndividualTopics().length === 0;
        if (noTopics) {
            return Promise.resolve({});
        }
        /* only pass in bulk subs with the replace flag – bulkSubscribe() will handle merging our individual topics (see PCM-1846) */
        return this.bulkSubscribe(bulkSubs, { replace: true });
    }
    subscriptionsKeepAlive() {
        const topic = 'streaming-subscriptions-expiring';
        if (this.topicHandlers(topic).length === 0) {
            this.createSubscription(topic, () => {
                this.client.logger.info(`${topic} - Triggering resubscribe.`, { channelId: this.client.config.channelId });
                this.debouncedResubscribe().catch((err) => {
                    const msg = 'Error resubscribing to topics';
                    this.client.logger.error(msg, err);
                    this.client.emit('pubsub:error', { msg, err });
                });
            });
        }
    }
    getTopicParts(topic) {
        const isCombined = topic.includes('?');
        const separator = isCombined ? '?' : '.';
        const split = topic.split(separator);
        const postfix = isCombined ? split[1] : split.splice(split.length - 1);
        const prefix = isCombined ? split[0] : split.join('.');
        let postfixes = [];
        if (isCombined) {
            postfixes = postfix.split('&');
        }
        else {
            postfixes = postfix;
        }
        return { prefix, postfixes };
    }
    setTopicPriorities(priorities = {}) {
        Object.keys(priorities).forEach(priority => {
            const topicParts = this.getTopicParts(priority);
            const oldPriorities = this.topicPriorities[topicParts.prefix];
            const newPriority = priorities[priority];
            if (oldPriorities) {
                topicParts.postfixes.forEach(postfix => {
                    const oldPriority = oldPriorities[postfix];
                    if ((oldPriority && oldPriority < newPriority) || !oldPriority) {
                        oldPriorities[postfix] = newPriority;
                    }
                });
            }
            else {
                const newTopics = topicParts.postfixes.reduce((newTopics, p) => {
                    newTopics[p] = newPriority;
                    return newTopics;
                }, {});
                this.topicPriorities[topicParts.prefix] = newTopics;
            }
        });
    }
    async subscribe(topic, handler, immediate, priority) {
        if (priority) {
            this.setTopicPriorities({ [topic]: priority });
        }
        let promise;
        if (!immediate) {
            // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
            promise = this.debouncedResubscribe();
        }
        else {
            promise = this.xmppSubscribe(topic);
        }
        if (handler) {
            this.createSubscription(topic, handler);
        }
        else {
            this.bulkSubscriptions[topic] = true;
        }
        const result = await promise;
        // Assume topic subscription succeeded if promise is resolved...
        let topicResult = { topic, state: 'Permitted' };
        // ... but if partial bulk resubscribe is enabled, use topic's individual result from the API response.
        if (this.enablePartialBulkResubscribe && result && typeof result === 'object' && isTopicSubscribeResult(result[topic])) {
            topicResult = result[topic];
        }
        // Topic result other than state=Permitted becomes a StreamingSubscriptionError promise rejection.
        if (topicResult.state !== 'Permitted') {
            const message = topicResult.rejectionReason || `Failed to subscribe topic ${topic}`;
            const missingPermissions = topicResult.missingPermissions;
            throw new _1.StreamingSubscriptionError(message, topic, 'subscribe', { missingPermissions });
        }
        return topicResult;
    }
    /**
     * Use `_subscribeInternal` when subscribing to a topic from within streaming-client itself.
     * Internal subscriptions won't be overwritten by subscriptions from consumers and will be prioritized
     * over subscriptions from consumers.
     */
    async _subscribeInternal(topic) {
        if (this.internalSubscriptions.includes(topic)) {
            return Promise.resolve();
        }
        this.setTopicPriorities({ [topic]: Number.MAX_VALUE });
        const promise = this.xmppSubscribe(topic);
        this.internalSubscriptions.push(topic);
        this.bulkSubscriptions[topic] = true;
        return promise;
    }
    unsubscribe(topic, handler, immediate) {
        if (handler) {
            this.removeSubscription(topic, handler);
        }
        else {
            delete this.bulkSubscriptions[topic];
            delete this.subscriptions[topic];
        }
        this.removeTopicPriority(topic);
        if (!immediate) {
            // let this and any other subscribe/unsubscribe calls roll in, then trigger a whole resubscribe
            return this.debouncedResubscribe();
        }
        return this.xmppUnsubscribe(topic);
    }
    async bulkSubscribe(topics, options = { replace: false, force: false }, priorities = {}) {
        var _a;
        this.setTopicPriorities(priorities);
        let toSubscribe = mergeAndDedup(topics, this.internalSubscriptions);
        if (options.replace && !options.force) {
            // if this is a bulk subscription, but not a forcible one, keep all individual subscriptions
            toSubscribe = mergeAndDedup(toSubscribe, this.getActiveIndividualTopics());
        }
        else if (options.force) {
            // if it's a forcible bulk subscribe, wipe out individual subscriptions
            this.subscriptions = {};
        }
        const response = await this.makeBulkSubscribeRequest(toSubscribe, options);
        let topicResponseEntities = [];
        if (response && response.data && 'entities' in response.data && Array.isArray(response.data.entities)) {
            topicResponseEntities = response.data.entities;
        }
        const result = {};
        for (const topicEntity of topicResponseEntities) {
            const { id, state, rejectionReason, missingPermissions } = topicEntity;
            result[id] = { topic: id, state, rejectionReason, missingPermissions };
            // If response entity is a combined topic ID like "a.b?c&d" include individualized topic IDs
            // as keys in the map. This could either point to the same result as the combined topic ID
            // or to a specific result for that individual topic if backend provides a specific result.
            // Example: caller asked to subscribe "a.b?c&d" but user lacks permission for topic "a.b.d"
            // In this case, API response will include "a.b?c&d" as success along with "a.b.d" as failure.
            if (id.includes('?')) {
                for (const individualTopic of (0, utils_1.splitIntoIndividualTopics)(id)) {
                    const hasIndividualTopicResult = result.hasOwnProperty(individualTopic);
                    // Only use the combined topic result for this individual topic ID if there isn't already
                    // a result for the individual topic itself. Exact topic result takes precedence.
                    if (!hasIndividualTopicResult) {
                        result[individualTopic] = result[id];
                    }
                }
            }
        }
        if (options.replace) {
            this.bulkSubscriptions = {};
        }
        topics.forEach(topic => {
            this.bulkSubscriptions[topic] = true;
        });
        this.internalSubscriptions.forEach(topic => {
            this.bulkSubscriptions[topic] = true;
        });
        // Add a fallback result for any topic in the toSubscribe list that isn't already in result.
        // With partial bulk resubscribe enabled missing result means "Unknown" state but when not
        // enabled the fallback is "Permitted" for backward compatibility (success response means OK).
        for (const topic of toSubscribe) {
            (_a = result[topic]) !== null && _a !== void 0 ? _a : (result[topic] = { topic, state: this.enablePartialBulkResubscribe ? 'Unknown' : 'Permitted' });
        }
        return result;
    }
    get expose() {
        return {
            subscribe: this.subscribe.bind(this),
            unsubscribe: this.unsubscribe.bind(this),
            bulkSubscribe: this.bulkSubscribe.bind(this)
        };
    }
}
exports.Notifications = Notifications;
function isTopicSubscribeResult(value) {
    let hasTopic = false;
    let hasValidState = false;
    if (value && typeof value === 'object') {
        hasTopic = 'topic' in value && typeof value.topic === 'string';
        hasValidState = 'state' in value && ['Permitted', 'Rejected', 'Unknown'].includes(value.state);
    }
    return hasTopic && hasValidState;
}
