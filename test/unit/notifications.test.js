'use strict';

const test = require('tap').test;
const td = require('../helpers').td;
const notifications = require('../../src/notifications');

let notification;
test('setup', t => {
  notification = td.replace('../../src/notifications');
  t.end();
});

test('notifications should return a module', t => {
  t.plan(1);
  t.ok(notifications, 'should return notifications module');
});

test('topicHandlers should return a topic', t => {
  t.end();
});

test('teardown', t => {
  td.reset();
  t.end();
});
