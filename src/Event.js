import { generateUId } from './utils';
import Joi from 'joi';

const restrictedEvents = ['error', 'subscribe', 'unsubscribe'];
const validEventPattern = /^([A-Za-z0-9]+\.?)+$/;
const delimiter = '.';

export default class Event {
  static validate(eventIdentifier) {
    Joi.assert(eventIdentifier, Joi.alternatives().try(
      Joi.string().required().regex(validEventPattern).invalid(restrictedEvents),
      Joi.array().min(1).items(Joi.string().regex(validEventPattern)),
      Joi.object().type(RegExp),
    ).required());
  }

  static normalize(eventIdentifier) {
    Event.validate(eventIdentifier);

    if (Array.isArray(eventIdentifier)) {
      return eventIdentifier.join(delimiter);
    }

    if (typeof eventIdentifier === 'string') {
      return eventIdentifier.trim();
    }

    return eventIdentifier;
  }

  static from(eventOrIdentifier) {
    if (eventOrIdentifier instanceof Event) {
      return eventOrIdentifier;
    }

    return new Event(eventOrIdentifier);
  }

  constructor(identifier, meta = {}) {
    this.identifier = Event.normalize(identifier);
    this.meta = meta;
    this.uid = generateUId();
  }

  toString() {
    return this.identifier.toString();
  }

  isMatch(matcher) {
    if (this.identifier instanceof RegExp && (typeof matcher === 'string')) {
      return this.identifier.test(matcher);
    }

    if (matcher instanceof RegExp && (typeof this.identifier === 'string')) {
      return matcher.test(this.identifier);
    }

    return this.toString() === matcher.toString();
  }
}