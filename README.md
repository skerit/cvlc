# cvlc

Cvlc can be used to control VLC command-line instances

## Install

```bash
$ npm install cvlc
```

## Todo

* Create methods that wrap around the possible commands
* Create methods that wrap around certain hotkeys:
  https://wiki.videolan.org/Hotkeys_table

## Examples

### Playing a file

```js
var Cvlc   = require('cvlc'),
    player = new Cvlc(),
    fs     = require('fs');

player.play('/path/to/file', function startedLocalFile() {
	// The file has started playing
});
```

### Playing a stream

```js
// Create a read stream
var stream = fs.createReadStream('/path/to/file');

player.play(stream, function startedStream() {
	// The stream has started playing
});
```

### Executing VLC commands

```js
player.cmd('rate 2', function gotResponse(err, response) {
	// Sound should be playing at twice the speed
});
```

### See more commands

You can get a list of all the commands by executing this command:

```js
player.cmd('longhelp', function gotCommands(err, response) {
	console.log('Available commands: ' + response);
});
```

### Destroying VLC process

When you no longer need the player, you need to manually destroy it.
Otherwise it will stay in memory, and the cvlc process will stay active.

```js
player.destroy();
```