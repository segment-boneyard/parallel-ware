
var assert = require('assert');
var parallel = require('..');

describe('parallel-ware', function () {

  it('should run with no middleware', function (done) {
    var middleware = parallel();
    middleware.run(done);
  });

  it('should run with no callback', function () {
    var middleware = parallel();
    middleware.run();
  });

  it('should pass through arguments', function (done) {
    var middleware = parallel()
      .use(function (input, output, next) {
        output.sum = input.reduce(function (memo, item) {
          return item + memo;
        }, 0);
        next();
      });
    var input = [1, 2];
    var output = {};
    middleware.run(input, output, function (err, inputResult, outputResult) {
      if (err) return done(err);
      assert.deepEqual(input, inputResult);
      assert(outputResult.sum === 3);
      done();
    });
  });

  it('should be able to run in parallel', function (done) {
    var vector = [false, false];
    var middleware = parallel()
      .use(mark(vector, 0))
      .use(mark(vector, 1))
      .run(function (err) {
        if (err) return done(err);
        assert.deepEqual(vector, [true, true]);
        done();
      });
  });

  it('should be wait for execution', function (done) {
    var vector = [false, false, false];
    var middleware = parallel()
      .when(wait(vector, 1), function check (next) {
        assert(vector[1]); // shouldn't get executed until vector[1] executed
        vector[2] = true;
        next();
      })
      .use(mark(vector, 0))
      .use(mark(vector, 1))
      .run(function (err) {
        if (err) return done(err);
        assert.deepEqual(vector, [true, true, true]);
        done();
      });
  });

  it('should be able to handle conflicts', function (done) {
    var vector = [false, false, false];
    var middleware = parallel()
      .when(wait(vector, 1), function check (vector, next) {
        assert(vector[1]); // shouldn't get executed until vector[1] executed
        vector[2] = true;
        vector[1] = false;
        next();
      })
      .use(mark(vector, 0))
      .use(mark(vector, 1))
      .conflict(function(key, existing, candidate) {
        if (candidate.value) {
          return candidate;
        }
        return existing;
      })
      .run(vector, function (err) {
        if (err) return done(err);
        assert.deepEqual(vector, [true, true, true]);
        done();
      });
  });

  it('should never execute a non-ready middleware', function (done) {
    var vector = [false, false, false];
    var middleware = parallel()
      .when(never, mark(vector, 0))
      .when(never, mark(vector, 1))
      .use(mark(vector, 2))
      .run(function (err) {
        if (err) return done(err);
        assert.deepEqual(vector, [false, false, true]);
        done();
      });
  });

  it('should not halt execution for an error', function (done) {
    var vector = [false, false, false];
    var error = new Error('An error');
    var thrownError = new Error('Thrown err');
    var middleware = parallel()
      .use(mark(vector, 0))
      .use(fail(error))
      .use(failThrow(thrownError))
      .use(mark(vector, 2))
      .run(function (err) {
        assert(err);
        assert(err.errors.length === 2);
        assert(err.errors[0] === error);
        assert(err.errors[1] === thrownError);
        assert.deepEqual(vector, [true, false, true]);
        done();
      });
  });


  it('should group executions by tier', function (done) {
    var vector = [false, false, false];
    var middleware = parallel()
      .when(wait(vector, 1), function(next) {
        assert.deepEqual(vector, [false, true, false]);
        vector[2] = true;
        next();
      }, 1)
      .when(wait(vector, 2), function(next) {
        assert.deepEqual(vector, [false, true, true]);
        vector[0] = true;
        next();
      })
      .use(mark(vector, 1))
      .run(function (err) {
        assert.deepEqual(vector, [true, true, true]);
        done();
      });
  });

  it('should group executions by tier and not execute some', function (done) {
    var vector = [false, false, false];
    var middleware = parallel()
      .when(function() {
        // as soon as vector 0 is set we execute
        return vector[0] && !vector[1];
      }, function(next) {
        // this should never run
        assert(false);
        next();
      }, 1)
      .when(wait(vector, 0), function(next) {
        // higher tier plugin that will execute first
        assert.deepEqual(vector, [true, false, false]);
        // setting vector 1 prevents first plugin from running
        vector[1] = true;
        vector[2] = true;
        next();
      })
      .use(mark(vector, 0))
      .run(function(err) {
        assert(!err);
        assert.deepEqual(vector, [true, true, true]);
        done();
      });
  });

  it('should emit progress events', function (done) {
    var vector = [false, false];
    var middleware = parallel()
      .use(mark(vector, 0))
      .use(mark(vector, 1));
    middleware.once('progress', function (progress) {
      done();
    });
    middleware.run();
  });

  it('should emit progress events for a specific job', function (done) {
    var vector = [false, false, false, false];
    var middleware = parallel()
      .use(function firstMark(next){vector[0] = true; next();})
      .use(function thirdMark(next){setTimeout(function() {vector[2] = true; next();}, 500);});
    var middlewaretwo = parallel()
      .use(function secondMark(next){vector[1] = true; next();})
      .use(function fourthMark(next){vector[3] = true; next();});

    var firstEmitter = middleware.run(function(err) {
    });
    firstEmitter.on('update', function(update) {
      if (update.type.indexOf('execution complete') === 0) {
        assert.deepEqual(vector, [true, true, true, true]);
        done();
      }
    });
    middlewaretwo.run(function(err) {
      assert.deepEqual(vector, [true, true, false, true]);
    });

  });

  it('should respect execution timeouts', function (done) {
    var vector = [false, false];
    var middleware = parallel()
      .use(function firstMark(next){setTimeout(function() {vector[2] = true; next();}, 1000);}, null, 500);

    middleware.run(function(err) {
      assert(err);
      assert.deepEqual(vector, [false, false]);
      done();
    });

  });

});

/**
 * Return a middleware that marks a boolean at `position`
 * in execution `vector`.
 *
 * @param {Array|Boolean} vector
 * @param {Number} position
 * @return {Function}
 */

function mark (vector, position, fn) {
  return function mark () {
    var next = arguments[arguments.length - 1];
    vector[position] = true;
    next();
  };
}

/**
 * Return a wait function that waits until the boolean at `position`
 * in the `vector` is true.
 *
 * @param {Array|Boolean} vector
 * @param {Number} position
 * @return {Function}
 */

function wait (vector, position) {
  return function () {
    return vector[position];
  };
}

/**
 * Return a middleware that always fails with `err`.
 *
 * @param {Error} err
 * @return {Function}
 */

function fail (err) {
  return function () {
    var next = arguments[arguments.length - 1];
    next(err);
  };
}

/**
 * Return a middleware that always fails by throwing an `err`.
 *
 * @param {Error} err
 * @return {Function}
 */

function failThrow (err) {
  return function () {
    throw err;
  };
}

/**
 * A wait function that should never run.
 *
 * @return {Boolean}
 */

function never () {
  return false;
}
