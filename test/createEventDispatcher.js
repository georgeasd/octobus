import Joi from 'joi';
import { expect } from 'chai';
import sinon from 'sinon';
import createEventDispatcher from '../src/createEventDispatcher';

describe('createEventDispatcher', () => {
  let dispatcher;

  beforeEach(() => {
    dispatcher = createEventDispatcher();
  });

  it('should return undefined when calling unregistered event with no params', () => (
    dispatcher.dispatch('test').then((result) => {
      expect(result).to.be.undefined();
    })
  ));

  it('should return the parameters when calling unregistered event', () => {
    const params = { it: 'works' };

    return dispatcher.dispatch('test', params).then((result) => {
      expect(result).to.deep.equal(params);
    });
  });

  it('should throw an error when dispatching an invalid event', () => {
    expect(dispatcher.dispatch).to.throw();
    expect(() => dispatcher.dispatch('')).to.throw();
    expect(() => dispatcher.dispatch(Math.random())).to.throw();
    expect(() => dispatcher.dispatch(/test/)).to.throw();
  });

  it('should return the result', () => {
    dispatcher.subscribe('test', () => 'it works');

    return dispatcher.dispatch('test').then((result) => {
      expect(result).to.equal('it works');
    });
  });

  it('should call the hooks', () => {
    const before = sinon.spy();
    const after = sinon.spy();

    dispatcher.onBefore('test', before);
    dispatcher.onAfter('test', after);

    const promise = dispatcher.dispatch('test');
    expect(before.called).to.be.true();
    return promise.then(() => {
      expect(after.called).to.be.true();
    });
  });

  it('should handle async / await', () => {
    dispatcher.subscribe('test2', () => 'works');

    dispatcher.subscribe('test1', async ({ dispatch }) => {
      const word = await dispatch('test2');
      return `it ${word}`;
    });

    return dispatcher.dispatch('test1').then((result) => {
      expect(result).to.equal('it works');
    });
  });

  it('should call the passed callbacks', () => {
    dispatcher.subscribe('test', (ev, cb) => {
      cb(null, 'it works');
    });

    return dispatcher.dispatch('test').then((result) => {
      expect(result).to.equal('it works');
    });
  });

  it('should lookup namespaces', () => {
    dispatcher.subscribe('namespace.test', () => 'it works');

    const { test } = dispatcher.lookup('namespace');

    return test().then((result) => {
      expect(result).to.equal('it works');
    });
  });

  it('should handle errors', () => {
    dispatcher.subscribe('test', (ev, cb) => {
      cb(new Error('it doesn\'t work!'), 'it works');
    });

    dispatcher.on('error', (err) => {
      expect(err).to.be.an.instanceof(Error);
    });

    return dispatcher.dispatch('test').then(() => {
    }, (err) => {
      expect(err).to.be.an.instanceof(Error);
      expect(err.message).to.equal('it doesn\'t work!');
    });
  });

  it('should send the parameters', () => {
    dispatcher.subscribe('test', ({ params }) => params);

    return dispatcher.dispatch('test', { hello: 'world' }).then((result) => {
      expect(result).to.deep.equal({ hello: 'world' });
    });
  });

  it('should validate the passed in parameters', () => {
    dispatcher.subscribe('test', ({ params }) => params, {
      schema: Joi.object({
        foo: Joi.any().valid('foo')
      }).required()
    });

    dispatcher.on('error', (err) => {
      expect(err).to.be.an.instanceof(Error);
    });

    return dispatcher.dispatch('test').catch((err) => {
      expect(err).to.be.an.instanceof(Error);
      expect(err.isJoi).to.be.true();
    });
  });

  it('should take into consideration the default parameters', () => {
    dispatcher.subscribe('test', ({ params }) => params, {
      defaultParams: {
        foo: 'bar'
      }
    });

    return dispatcher.dispatch('test').then((result) => {
      expect(result).to.deep.equal({
        foo: 'bar'
      });
    });
  });

  it('should be able to subscribe using regular expressions', () => {
    dispatcher.subscribe(/^te/, ({ next, params }) => next(`${params} works`));

    dispatcher.subscribe(/st$/, ({ next }) => next('it'));

    return dispatcher.dispatch('test').then((result) => {
      expect(result).to.equal('it works');
    });
  });

  it('should handle regular expressions with higher precedence than strings', () => {
    dispatcher.subscribe(/^test$/, ({ params, next }) => next(`${params || ''} first`));
    dispatcher.subscribe('test', ({ params, next }) => next(`${params || ''} second`));

    return dispatcher.dispatch('test').then((result) => {
      expect(result.trim()).to.equal('first second');
    });
  });

  it('should subscribe to a map of handlers', () => {
    const namespace = 'some.random.namespace';

    dispatcher.subscribeMap(`${namespace}.Something`, {
      foo({ dispatch, params = {} }) {
        return dispatch(`${namespace}.Something.bar`, Object.assign({}, params, {
          foo: true
        }));
      },

      bar({ params = {} }) {
        return Object.assign({}, params, {
          bar: true
        });
      }
    });

    const Something = dispatcher.lookup(`${namespace}.Something`);

    return Something.foo().then((result) => {
      expect(result).to.deep.equal({
        foo: true,
        bar: true
      });
    });
  });
});
