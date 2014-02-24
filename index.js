
var Batch = require('batch');
var debug = require('debug')('parallel');
var defaults = require('defaults');
var Emitter = require('events').EventEmitter;
var inherit = require('util').inherits;
var domain = require('domain');
var flatnest = require('flatnest');

/**
 * Expose `Parallel`.
 */

module.exports = Parallel;

/**
 * Initialize a new `Parallel` object.
 */

function Parallel (options) {
  if (!(this instanceof Parallel)) return new Parallel(options);
  this.middleware = [];
  this.options = defaults(options, { concurrency: 100 });
}

/**
 * Inherit from `Emitter`.
 */

inherit(Parallel, Emitter);

/**
 * Sets the `max` amount of middleware executing concurrently.
 *
 * @param {Number} max
 * @return {Parallel}
 */

Parallel.prototype.concurrency = function (max) {
  this.options.concurrency = max;
  return this;
};

/**
 * Use a middleware `fn`.
 *
 * @param {Function} fn
 * @return {Parallel}
 */

Parallel.prototype.use = function (fn) {
  if (typeof fn !== 'function')
    throw new Error('You must provide a function.');
  this.middleware.push([immediate, fn]);
  return this;
};

/**
 * Use a middleware `fn` after the `wait` function returns
 * that its ready.
 *
 * @param {Function} wait
 * @param {Function} fn
 * @return {Parallel}
 */

Parallel.prototype.when = function (wait, fn, tier) {
  if (typeof wait !== 'function' || typeof fn !== 'function')
    throw new Error('You must provide a `wait` and `fn` functions.');
  this.middleware.push([wait, fn, tier]);
  return this;
};

Parallel.prototype.conflict = function (fn) {
  if (typeof fn !== 'function')
    throw new Error('You must provide a conflict function.');
  this.conflictFn = fn;
  return this;
};

/**
 * Execute the middleware with the provided `args`
 * and optional `callback`.
 *
 * @param {Mixed} args...
 * @param {Function} callback
 * @return {Parallel}
 */

Parallel.prototype.run = function () {
  var self = this;
  var last = arguments[arguments.length - 1];
  var callback = 'function' == typeof last ? last : null;
  var error = new BatchError();
  var args = callback
    ? [].slice.call(arguments, 0, arguments.length - 1)
    : [].slice.call(arguments);

  var executions = this.middleware.map(function (fns) {
    return new Execution(fns[0], fns[1], fns[2]);
  });

  // lets make the assumption that args are objects
  var updateArgs = {};

  function runBatch (callback) {
    var executed = 0; // count the amount of executed middleware

    var waitBatch = new Batch().concurrency(self.options.middleware);
    var batch = new Batch().concurrency(self.options.middleware);
    batch.throws(false);

    // run all wait functions
    executions.forEach(function (execution) {
      if (execution.executed) return; // we've already executed this
      waitBatch.push(function (done) {
        executeWait(args, execution.wait, function (err, ready) {
          if (err) {
            executed.executed = true; // if error in wait, dont execute again
            error.add(err);
            return done();
          }

          execution.ready = ready;
          done();
        });
      });
    });

    // upon completion get all ready executions
    // sort by tier and run all those in the highest tier
    // this works for case of no tier 0 ready, but a tier 1 ready.
    waitBatch.end(function (err) {
      var sortedExecutions = executions.filter(function(e) {
        return !e.executed && e.ready;
      }).sort(function(a, b) {
        return a.tier - b.tier;
      });
      var cuttoffIndex = sortedExecutions.length;
      var lowest = (sortedExecutions[0] && sortedExecutions[0].tier) || 0;
      for (var i=0; i < cuttoffIndex; i++) {
        if (sortedExecutions[i].tier > lowest) {
          cuttoffIndex = i;
        }
      }

      sortedExecutions.slice(0, cuttoffIndex).forEach(function (execution) {
        batch.push(function (done) {
          var arr = [].slice.call(args);
          var cb = function (err) {
            executed += 1;
            execution.executed = true;
            debug('middleware %s executed', execution.fn.name);
            if (err) {
              error.add(err);
              return done();
            }
            var flattened = flatnest.flatten(args);
            // find diff of flattend from updatArgs
            Object.keys(flattened).forEach(function(k) {
              var v = {
                value: flattened[k],
                fnName: execution.fn.name
              };
              if (updateArgs.hasOwnProperty(k)) {
                if (v.value !== updateArgs[k].value) {
                  // merge conflict
                  // store all previous options under a choices key
                  var choicesKey = k + '__choices';
                  if (!updateArgs[choicesKey]) {
                    updateArgs[choicesKey] = [updateArgs[k], v];
                  } else {
                    updateArgs[choicesKey].push(v);
                  }
                  // resolve conflict if we have a conflict function defined
                  if ('function' == typeof self.conflict) {
                    var conflictArgs = [k, updateArgs[k], v, updateArgs[choicesKey]].concat([].slice.call(args));
                    v = self.conflictFn.apply(null, conflictArgs);
                    // make sure args at path have the correct value
                    flatnest.replace(args, k, v.value);
                  }
                  updateArgs[k] = v;
                }
                // otherwise value is the same - assume earlier execution set it
              } else {
                // store the new value in our list.
                updateArgs[k] = v;
              }
            });
            done(); // don't pass back the error to batch or it'll exit
          };
          arr.push(cb);

          debug('middleware %s is ready to run ..', execution.fn.name);
          // wrap it in a custom domain to convert thrown exceptions into returned ones
          var d = domain.create();
          d.on('error', function(err){
            console.log('domain received %s', err);
            debug('error processing parallel function: %s \n %s', err, err.stack);
            cb(err);
          });
          d.run(function() {
            execution.executed = true;
            execution.fn.apply(null, arr);
          });
        });
      });

      batch.on('progress', function (progress) {
        self.emit('progress', progress);
      });

      // pass back the total amount of executed steps
      batch.end(function (err) {
        if (err) {
          err.forEach(function(e) {
            if (e) {
              error.add(e);
            }
          });
        }
        batch.removeAllListeners();
        debug('finished batch with %d executions', executed);
        callback(err, executed);
      });
    });

    return batch;
  }

  function next () {
    var batch = runBatch(function (err, executed) {
      // if we executed anything, run through the middleware again
      // to make sure no wait dependencies were blocked
      if (executed > 0) return next();
      // at this point, there's nothing left to execute, so return
      if (callback) {
        err = error.errors.length > 0 ? error : null;
        var arr = [].slice.call(args);
        arr.unshift(err);
        callback.apply(null, arr);
      }
    });
  }

  next();
  return this;
};

/**
 * Executs the wait function with support for synchronous (equal `args.length`)
 * and asynchronous (equals `args.length` + 1) function signatures.
 *
 * @param {Array|Object} args
 * @param {Function} waitFn
 * @param {Function} callback
 */

function executeWait (args, waitFn, callback) {
  // wrap everyithing in a domain to convert thrown errors into returned errors.
  var d = domain.create();
  d.on('error', function(err){
    // handle the error safely
    debug('error processing wait function: %s \n %s', err, err.stack);
    callback(err);
  });
  d.run(function(){
    var arr = [].slice.call(args);
    if (waitFn.length > args.length) {
      // asynchronous case, more arguments than inputs so assume callback
      // wrap in a tick to allow to remedy call stack explosion
      process.nextTick(function () {
        arr.push(callback);
        waitFn.apply(null, arr);
      });
    } else {
      // synchronous case, amount of arguments is less or equal to arity
      process.nextTick(function () {
        var result = waitFn.apply(null, arr);
        if (result instanceof Error) return callback(result);
        callback(null, result);
      });
    }
  });
}

/**
 * A wait function that always returns true.
 *
 * @return {Boolean}
 */

function immediate () {
  return true;
}

/**
 * A single middleware execution.
 *
 * @param {Function} wait
 * @param {Function} fn
 */

function Execution (wait, fn, tier) {
  this.wait = wait;
  this.fn = fn;
  this.tier = tier || 0;
  this.ready = false;
  this.executed = false;
}

/**
 * A batch error.
 */

function BatchError () {
  Error.call(this);
  Error.captureStackTrace(this, arguments.callee);
  this.errors = [];
  this.message = 'No errors have occured.';
}

/**
 * Inherit from `Error`.
 */

inherit(BatchError, Error);

/**
 * Add an error to the batch.
 *
 * @param {Error} err
 * @returns {BatchError}
 */

BatchError.prototype.add = function (err) {
  this.errors.push(err);
  this.message = this.errors.length + ' error(s) have occured: ' +
    this.errors.map(function (err) { return err.toString(); }).join(', ');
  return this;
};
