var Cvlc    = require('../index'),
    file    = __dirname + '/ubuntu-login.ogg',
    Fn      = __Protoblast.Bound.Function,
    fs      = require('fs');

Fn.series(function playSynchronized(next) {
	// Resume both players as soon as both streams have loaded

	var pone = new Cvlc({debug: true}),
	    ptwo = new Cvlc({debug: true});

	Fn.parallel(function one(next) {
		pone.load(fs.createReadStream(file), next);
	}, function two(next) {
		setTimeout(function() {
			ptwo.load(fs.createReadStream(file), next);
		}, 1000)
	}, function done() {
		pone.play();
		ptwo.play();
		next();
	});

}, function loadStream(next) {
	var stream = fs.createReadStream(file),
	    player = new Cvlc({debug: true});

	console.time('loading_stream');
	player.load(stream, function loadedStream() {
		console.timeEnd('loading_stream');

		// Resume loaded file
		setTimeout(function resumePlay() {
			console.log('Resuming queued stream');
			player.play();

			setTimeout(next, 6000);
		}, 1000);
	});

}, function localFile(next) {

	var player = new Cvlc({debug: true});

	// File test
	console.time('starting_local');
	player.play(file, function startedLocalFile() {
		console.timeEnd('starting_local');

		setTimeout(next, 6000);
	});
}, function streamFile(next) {
	var stream = fs.createReadStream(file),
	    player = new Cvlc({debug: true});

	console.time('starting_stream');
	player.play(stream, function startedStream() {
		console.timeEnd('starting_stream');

		setTimeout(next, 6000);
	});
}, function done(err) {
	console.log('Finished examples', err);
});

// Function to test vlc delays (buggy)
function delayFile() {
	var stream = fs.createReadStream(file),
	    player = new Cvlc({debug: true});

	console.time('starting_stream');
	player.play(stream, function startedStream() {
		console.timeEnd('starting_stream');

		setTimeout(function() {
			
			Fn.series(function rewind(next) {
				player.cmd('seek 1', next)
			}, function rate(next) {
				console.time('rate3')
				player.cmd('rate 3', function() {
					console.timeEnd('rate3');

					setTimeout(function() {
						player.cmd('rate 1');
					}, 200)

					
				});

				next();
			}, function done() {

			});
		}, 1000);
	});
}

//delayFile();