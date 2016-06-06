import { set, get } from 'lodash';
import Joi from 'joi';
import EventEmitter from 'events';
import { createOneTimeCallable, validateEvent } from './utils';

const callableErrorMessage = 'The result was already handled!';

const defaultOptions = {
  delimiter: '.',

  createEventEmitter() {
    const emitter = new EventEmitter();
    emitter.on('error', () => {});
    return emitter;
  },

  processParams(params, config = {}) {
    const { defaultParams, schema } = config;
    let finalParams = params;

    if (defaultParams) {
      finalParams = Object.assign({}, defaultParams, params);
    }

    if (schema) {
      finalParams = Joi.attempt(finalParams, schema);
    }

    return finalParams;
  },
};

export default (_options = {}) => {
  const {
    delimiter,
    processParams,
    createEventEmitter,
  } = Object.assign({}, defaultOptions, _options);

  const store = {
    eventsMap: new Map(),
    matchersMap: new Map(),
    eventsTree: {},
    proxies: {},
  };

  const emitter = createEventEmitter();
  const on = (...args) => emitter.on(...args);
  const emit = (event, ...args) => emitter.emit(event, ...[args.concat([{ dispatch, lookup }])]);
  const onBefore = (event, ...args) => on(`before:${event}`, ...args);
  const onAfter = (event, ...args) => on(`after:${event}`, ...args);
  const emitBefore = (event, ...args) => emit(`before:${event}`, ...args);
  const emitAfter = (event, ...args) => emit(`after:${event}`, ...args);

  const subscribe = (event, handler, config = {}) => {
    if (typeof handler !== 'function') {
      throw new Error(`
        Event handler for ${event.toString()} has to be a function (got ${typeof handler} instead)!
      `);
    }

    event = validateEvent(event, delimiter); // eslint-disable-line no-param-reassign
    const subscriber = { handler, config };

    if (event instanceof RegExp) {
      store.matchersMap.set(event, subscriber);
    }

    if (typeof event === 'string') {
      if (!store.eventsMap.has(event)) {
        store.eventsMap.set(event, []);
        set(store.eventsTree, event, store.eventsMap.get(event));
      }

      store.eventsMap.get(event).unshift(subscriber);
    }

    emit('subscribed', event, subscriber);

    return () => unsubscribe(event, handler);
  };

  const subscribeMap = (prefix, map) => (
    Object.keys(map).reduce((acc, method) => {
      const event = `${prefix}${delimiter}${method}`;
      const handler = map[method];
      subscribe(event, handler);

      return Object.assign(acc, {
        [method]: () => unsubscribe(event, handler),
      });
    }, {})
  );

  const unsubscribe = (event, handler = null) => {
    if (store.matchersMap.has(event)) {
      store.matchersMap.delete(event);
    }

    if (store.eventsMap.has(event)) {
      if (!handler) {
        store.eventsMap.delete(event);
      } else {
        const index = store.eventsMap.get(event).findIndex(
          (subscriber) => subscriber.handler === handler
        );
        if (index > -1) {
          store.eventsMap.get(event).splice(index, 1);
        }
      }
    }

    emit('unsubscribed', event, handler);
  };

  const dispatch = (event, params, options = {}, done) => {
    event = validateEvent(event, delimiter); // eslint-disable-line no-param-reassign

    if (!done && typeof options === 'function') {
      done = options; // eslint-disable-line no-param-reassign
      options = {}; // eslint-disable-line no-param-reassign
    }

    if (typeof event !== 'string') {
      throw new Error(
        `You can only dispatch events of type string and array (got ${typeof event} instead).`
      );
    }

    let subscribers;

    if (store.proxies[event]) {
      const { targetEvent, paramsTransformer } = store.proxies[event];
      subscribers = getEventSubscribersMatching(targetEvent);
      params = paramsTransformer(params); // eslint-disable-line no-param-reassign
    } else {
      subscribers = getEventSubscribersMatching(event);
    }

    if (!subscribers.length) {
      return Promise.reject(new Error(`No subscribers registered for the ${event} event.`));
    }

    emitBefore(event, params, { dispatch, lookup, options });
    return cascadeSubscribers(subscribers, params, options).then((result) => {
      emitAfter(event, result, { dispatch, lookup, options });

      return done ? done(null, result) : result;
    }, (err) => {
      if (done) {
        return done(err);
      }

      throw err;
    });
  };

  const proxy = (sourceEvent, targetEvent, paramsTransformer = (i) => i) => {
    store.proxies[sourceEvent] = { targetEvent, paramsTransformer };
  };

  const lookup = (path) => {
    const methods = get(store.eventsTree, path, {});

    return Object.keys(methods).reduce((acc, methodName) => (
      Object.assign(acc, {
        [methodName]: (params) => dispatch(`${path}${delimiter}${methodName}`, params),
      })
    ), {});
  };

  const runHandler = (handler, params, options, config, next) => {
    let resolve;
    let reject;

    const promise = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });

    const handleResult = createOneTimeCallable((err, result) => {
      if (err) {
        emitter.emit('error', err);
        reject(err);
      } else {
        resolve(result);
      }
    }, callableErrorMessage);

    const reply = (value) => {
      const err = value instanceof Error ? value : null;
      handleResult(err, value);
    };

    try {
      params = processParams(params, config); // eslint-disable-line no-param-reassign

      const result = handler({
        params,
        options,
        next,
        dispatch,
        lookup,
        emit,
        emitBefore,
        emitAfter,
        reply,
      }, handleResult);

      if (result !== undefined) {
        handleResult(null, result);
      }
    } catch (err) {
      handleResult(err);
    }

    return promise;
  };

  const getEventSubscribersMatching = (event) => {
    let subscribers = [];

    store.matchersMap.forEach((subscriber, matcher) => {
      if (matcher.test(event)) {
        subscribers.unshift(subscriber);
      }
    });

    if (store.eventsMap.has(event)) {
      subscribers = subscribers.concat(store.eventsMap.get(event));
    }

    return subscribers;
  };

  const cascadeSubscribers = (subscribers, params, options) => {
    if (!subscribers.length) {
      return Promise.resolve(params);
    }

    const { handler, config } = subscribers.shift();

    const next = (nParams, nOptions) => cascadeSubscribers(subscribers, nParams, nOptions);

    return runHandler(handler, params, options, config, next);
  };

  return {
    emit, emitBefore, emitAfter, on, onBefore, onAfter,
    dispatch, subscribe, unsubscribe, subscribeMap, lookup, proxy,
  };
};
