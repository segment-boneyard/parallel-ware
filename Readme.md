
# parallel-ware

  A [ware](https://github.com/segmentio/middleware) clone that executes middleware in parallel. Supports a simple API for managing execution order.

## Example

The following example runs all the middleware in parallel.

```js
var parallel = require('parallel-ware');

function add (val) {
  return function (calc, next) {
    calc.sum += val;
    console.log(calc.sum);
    next();
  };
}

// executes in parallel, no order guarenteed
var middleware = parallel()
  .use(add(1))
  .use(add(2))
  .use(add(3));

middleware.run({ sum: 0 }, function (err, result) {
  // all the middleware has run, calc.sum equals 6
});

// 2
// 5
// 6
```

### Wait to Execute

You can also tell parallel-ware to wait to execute a middleware until a specific condition is met. The `.when(wait, fn)` method takes the wait function as an optional first parameter.

```js
var parallel = require('parallel-ware');

function add (val) {
  return function (calc, next) {
    calc.sum += val;
    console.log(calc.sum);
    next();
  };
}

function equals (val) {
  return function (calc, next) {
    next(null, calc.sum === val);
  };
}

var middleware = parallel()
  .use(add(1))
  .when(equals(4), add(2)) // executes after sum === 4
  .when(equals(10), add(10)) // executes after sum === 10, which never happens
  .use(add(3));

middleware.run({ sum: 0 }, function (err, calc) {
  // all the middleware has run, calc.sum equals 6
});

// 3
// 4
// 6
```

### Managing Concurrency

You can limit the concurrency with which the middleware will get executed.

```js
var middleware = parallel()
  .concurrency(2)
  .use(constantContact())
  .use(linkedin())
  .use(facebook())
  .use(github());
```

### Monitoring Progress

And you can listen for progress events (following the same structure as [visionmedia/batch](https://github.com/visionmedia/batch) progress events).

```js
var middleware = parallel()
  .use(constantContact())
  .use(linkedin())
  .use(facebook())
  .use(github());

middleware.on('progress', function (progress) {
  
});

middleware.run({ email: 'michael.bolton@initech.com' });
```

### Error Handling

Middleware errors don't stop the overall execution, but are rather passed back in batch.

```js
var parallel = require('parallel-ware');

function add (val) {
  return function (calc, next) {
    calc.sum += val;
    next();
  };
}

function fail (animal) {
  return function (calc, next) {
    next(new Error(animal));
  };
}

// executes in parallel, no order guarenteed
var middleware = parallel()
  .use(add(1))
  .use(fail('porcupine'))
  .use(add(2))
  .use(fail('whale'))
  .use(add(3));

middleware.run({ sum: 0 }, function (err, calc) {
  if (err) {
    console.log(err);
    console.log(err.errors)
  }
  console.log(calc.sum);
});

// Error: 2 error(s) encountered.
// [Error: Whale, Error: Porcupine]
// 6
```

## API

### parallel()

  Create a parallel middleware execution pipeline.

### .use([wait,] fn)

  Add a middleware `fn` to the execution pipeline. If a `wait` function is provided, then `fn` won't get executed until the `wait` function returns a truthy result.

  The wait function supports a synchronous signature:

```js
function equals (val) {
  return function (calc) {
    return calc.sum === val;
  };
}

var middleware = parallel()
  .use(add(1))
  .when(equals(4), add(2)) // executes after sum === 4
  .when(equals(10), add(10)) // executes after sum === 10, which never happens
  .use(add(3));

middleware.run({ sum: 0 }, function (err, calc) {
  // all the middleware has run, calc.sum equals 6
});
```

  And an asynchronous signature:

```js
function equals (val) {
  return function (calc, next) {
    next(null, calc.sum === val);
  };
}

var middleware = parallel()
  .use(add(1))
  .when(equals(4), add(2)) // executes after sum === 4
  .when(equals(10), add(10)) // executes after sum === 10, which never happens
  .use(add(3));

middleware.run({ sum: 0 }, function (err, calc) {
  // all the middleware has run, calc.sum equals 6
});
```

### .concurrency(max)

  Limit the amount of concurrently executing middleware to `max`.

### .on('progress', ..

  Listen on progress events.

## License

```
WWWWWW||WWWWWW
 W W W||W W W
      ||
    ( OO )__________
     /  |           \
    /o o|    MIT     \
    \___/||_||__||_|| *
         || ||  || ||
        _||_|| _||_||
       (__|__|(__|__|
```

[Copyright (c) 2013](https://animals.ivolo.me) [Segment.io](https://segment.io) &lt;friends@segment.io&gt;
