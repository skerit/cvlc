var Cvlc    = require('../index'),
    player1 = new Cvlc({debug: true}),
    player2 = new Cvlc({debug: true}),
    file    = __dirname + '/ubuntu-login.ogg',
    fs      = require('fs'),
    stream;

// File test
console.time('starting_local');
player1.play(file, function startedLocalFile() {
	console.timeEnd('starting_local');
});

// Stream test
stream = fs.createReadStream(file);

console.time('starting_stream');
player2.play(stream, function startedStream() {
	console.timeEnd('starting_stream');

	player2.cmd('rate 3', function gotResponse(err, response) {
		// Sound should be playing at twice the speed
	});
});