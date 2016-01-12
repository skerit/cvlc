var Blast        = __Protoblast,
    Obj          = Blast.Bound.Object,
    Fn           = Blast.Bound.Function,
    instances    = [],
    ChildProcess = require('child_process'),
    portfinder   = require('portfinder'),
    telnet       = require('telnet-client'),
    fs           = require('fs'),
    port_queue   = Fn.createQueue({enabled: true, limit: 1}),
    Cvlc;

// Change portfinder's starting port to match VLC's default
portfinder.basePort = 4213;

/**
 * The Cvlc class
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc = Fn.inherits('Informer', function Cvlc(options) {

	this.options = options || {};

	if (this.options.debug) {
		this.debug = true;
	}

	// Hinder object, so only 1 instance gets created
	this.hinder = null;

	// Amount of files played by this instance
	this.playcount = 0;

	// The default play mode is 'stream' (over pipes)
	this.play_mode = 'stream';

	// The next mode
	this.next_mode = null;

	// Pause status
	this.paused = false;

	// Is a file queued to be played?
	this.queued = false;

	// Store this instance
	instances.push(this);

	// Create the instance
	this.getInstance();
});

/**
 * Create the VLC instance
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}   callback   Function to be called when VLC is ready
 */
Cvlc.setMethod(function getInstance(force, callback) {

	var that = this,
	    done,
	    args;

	if (typeof force == 'function') {
		callback = force;
		force = false;
	}

	if (force) {
		if (this.debug) console.log('Forced to create new instance, killing old one');
		this.kill();
		this.hinder = null;
	}

	if (this.hinder) {
		if (callback) {
			this.hinder.push(callback);
		}
		return;
	}

	this.hinder = Fn.hinder(function initVlc(done) {

		var retries = 0;

		// Auto-generate a password for the telnet interface
		that.password = Blast.Classes.Crypto.pseudoHex();

		Fn.series(function getPort(next) {

			if (that.debug) console.log('Getting free port for telnet interface');

			// Get a free port to run the telnet server under
			port_queue.add(function getQueuedPort(done) {
				portfinder.getPort(function gotPort(err, port) {

					if (err) {
						return next(err);
					}

					if (that.debug) console.log('Got port', port);

					// Make sure portfinder doesn't try this port again
					portfinder.basePort = port + 1;

					that.port = port;
					done();
					next();
				});
			});
		}, function createProcess(next) {

			var args = [
				'--intf', 'telnet',
				'--telnet-port', that.port,
				'--telnet-password', that.password,
				'-' // Start by listening to the input by default
			];

			if (that.debug) console.log('Creating cvlc process');

			that.proc = ChildProcess.execFile('cvlc', args);

			// Listen to stderr, wait for interface information
			that.proc.stderr.on('data', function gotData(chunk) {

				var str = '' + chunk;

				if (str.indexOf('Listening on host') > -1) {
					that.proc.stderr.removeListener('data', gotData);

					next();
				}
			});
		}, function connectToInterface(next) {

			if (that.debug) console.log('Connecting to telnet interface at port', that.port);

			that.connection = new telnet();

			// Connect to the cvlc telnet interface
			that.connection.connect({
				host: '127.0.0.1',
				port: that.port,
				shellPrompt: '> ',
				password: that.password,
				echoLines: 0
			});

			// Vlc LIES: even though it states the interfaces is ready,
			// requests made within +/- 10ms will probably fail,
			// so retry if it does
			that.connection.on('error', function gotError(err) {

				if (err.code == 'ECONNREFUSED') {
					retries++;

					if (retries > 5) {
						return next(err);
					}

					if (that.debug) console.error('Retrying telnet connection...');

					// Try to make the connection again
					setTimeout(function tryAgain() {
						connectToInterface(next);
					}, 4);
				} else {
					console.error('Cvlc Telnet error: ' + err);
				}
			});

			// Wait for the ready signal
			that.connection.on('ready', function gotPrompt(prompt) {
				if (that.debug) console.log('Telnet connection established');
				next();
			});
		}, function finished(err) {

			if (err) {
				if (that.debug) console.error('Failed to create instance: ' + err);

				if (callback) {
					return callback(err);
				} else {
					throw err;
				}
			}

			// Emit the ready event, indicating cvlc has started
			// and is ready to be controlled
			that.emit('ready');

			if (callback) {
				callback();
			}

			done();
		});
	});

	if (this.debug) console.log('Created cvlc hinder object');
});

/**
 * Send a command to VLC over the telnet interface
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function cmd(command, callback) {

	var that = this;

	// Make sure the instance is ready
	this.getInstance(function gotInstance() {

		if (that.debug) console.log('Sending', command, 'command to cvlc');

		that.connection.exec(command, callback);
	});
});

/**
 * Set the file/stream to play
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function setFile(file) {

	var mode;

	if (this.debug) console.log('Setting file:', typeof file);

	if (!file) {
		throw new Error('Undefined file given');
	}

	if (typeof file == 'object') {
		// Check for streams
		if (typeof file.read == 'function' && typeof file.on == 'function') {
			mode = this.setStream(file);
		} else {
			// Check for buffers?
			throw new Error('Not a valid stream');
		}
	} else if (typeof file == 'string') {
		if (file.slice(0, 4) == 'http') {
			mode = this.setUrl(file);
		} else {
			mode = this.setPath(file);
		}
	} else {
		throw new Error('Not a valid filename given');
	}

	this.next_mode = mode;

	if (this.debug) console.log('File set, next mode:', mode);

	return mode;
});

/**
 * Set a stream to play
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function setStream(stream) {

	// Store the stream
	this.file_stream = stream;

	// Pause the stream
	stream.pause();

	return 'stream';
});

/**
 * Set a url to play
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function setUrl(url) {

	// Store the url
	this.file_url = url;

	return 'file';
});

/**
 * Set a path to play
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function setPath(file_path) {

	// Store the path
	this.file_path = file_path;

	return 'file';
});

/**
 * Pause the player
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}        callback
 */
Cvlc.setMethod(function pause(callback) {

	if (!this.paused) {
		this.paused = true;
		this.cmd('pause', callback);
	} else {
		callback();
	}
});

/**
 * Resume the player
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}        callback
 */
Cvlc.setMethod(function resume(callback) {

	var that = this;

	if (this.paused) {

		this.cmd('pause', function gotResponse(err, response) {

			if (!err) {
				that.paused = false;
			}

			if (callback) callback(err, response);
		});
	} else {
		callback();
	}
});

/**
 * Queue the file set to play, but don't play it yet.
 * Switches player to paused mode.
 * Calls back when commands have executed, not when file is ready
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}        callback
 */
Cvlc.setMethod(function queue(optional_file, callback) {

	var that = this;

	if (typeof optional_file == 'function') {
		callback = optional_file;
		optional_file = null;
	}

	if (this.debug) console.log('Going to queue file in paused mode');

	this._queueFile(optional_file, true, callback);
});

/**
 * Load the file set to play, but don't play it yet.
 * Switches player to paused mode.
 * Calls back when the file is ready to be played (streams)
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}        callback
 */
Cvlc.setMethod(function load(optional_file, callback) {

	var that = this;

	if (typeof optional_file == 'function') {
		callback = optional_file;
		optional_file = null;
	}

	if (this.debug) console.log('Going to load file in paused mode');

	this._queueFile(optional_file, true, function queuedFile() {

		if (that.chunk_count) {
			return callback();
		}

		that.once('initial_chunk', callback);
	});
});

/**
 * Load the file set to play, and pause the player if needed
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String|Stream}   file        File to load, or null
 * @param    {Boolean}         do_pause    True to pause, false to resume, null to leave it
 * @param    {Function}        callback    Executed when file has been queued
 */
Cvlc.setMethod(function _queueFile(file, do_pause, callback) {

	var that = this;

	console.log('File:', file, 'do pause:', do_pause, 'callback:', callback);

	if (file) {
		that.setFile(file);
	}

	this.queued = false;
	this.queueing = true;

	Fn.series(function getInstance(next) {
		that.getInstance(next);
	}, function checkMode(next) {

		var old_mode  = that.play_mode,
		    next_mode = that.next_mode;

		that.play_mode = next_mode;

		// If nothing has played yet, and the modes are correct,
		// just continue on playing (this means a stream)
		if (old_mode == next_mode && that.playcount == 0) {
			return next();
		}

		// If the next mode is a stream, and something has played already,
		// a new instance needs to be made
		if (that.playcount && next_mode == 'stream') {
			return that.getInstance(true, next);
		}

		// Stop whatever is currently playing
		that.cmd('stop', function stopped(err, response) {

			if (err) {
				return next(err);
			}

			that.cmd('clear', function cleared(err, response) {

				if (err) {
					return next(err);
				}

				next();
			});
		});
	}, function doPause(next) {

		if (do_pause === false) {
			that.resume(next);
		} else if (do_pause === true) {
			that.pause(next);
		} else {
			next();
		}
	}, function loadFile(next) {

		var chunk_count = 0;

		if (that.play_mode == 'file') {
			if (that.debug) console.log('Queueing file', (that.file_path || that.file_url));
			that.cmd('add ' + (that.file_path || that.file_url), next);
			that.chunk_count = 1;
		} else {
			// Reset chunk count
			that.chunk_count = 0;

			that.file_stream.on('data', function onData(chunk) {

				// Write to vlc's standard input
				that.proc.stdin.write(chunk);
				chunk_count++;
				that.chunk_count = chunk_count;

				if (chunk_count == 1) {
					that.emit('initial_chunk');
					if (that.debug) console.log('Got first stream chunk of', chunk.length, 'bytes at', Date.now());
				}
			});

			// Resume the stream
			that.file_stream.resume();
			next();
		}
	}, function done(err) {

		if (err) {
			if (callback) {
				return callback(err);
			} else {
				return that.emit('error', err);
			}
		}

		// If the player is paused, it will now have a file waiting
		// if it's not, it'll start playing immediately
		if (that.paused) that.queued = true;
		that.queueing = false;

		if (that.debug) {
			if (that.queued) {
				console.log('File has been queued');
			} else {
				console.log('Queued file has started playing immediately')
			}
		}

		if (callback) callback();
	});
});

/**
 * Actually start playing the file
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String|Stream}   optional_file   The file to play [optional]
 * @param    {Function}        callback        Called when file starts playing
 */
Cvlc.setMethod(function play(optional_file, callback) {

	var that = this;

	if (typeof optional_file == 'function') {
		callback = optional_file;
		optional_file = null;
	}

	if (!callback) {
		callback = Fn.thrower;
	}

	// If a file is given, load and play it
	if (optional_file) {
		return that._queueFile(optional_file, false, function queuedFile(err) {

			if (err) {
				return callback(err);
			}

			if (that.chunk_count) {
				return callback();
			}

			that.once('initial_chunk', callback);
		});
	}

	if (this.debug) console.log('Going to play, current pause status:', this.paused);

	// If no file is given, check the pause status
	Fn.series(function getInstance(next) {
		that.getInstance(next);
	}, function checkQueue(next) {

		if (that.queueing || that.queued) {
			if (that.paused) {
				that.resume(next);
			} else {
				next();
			}
		}

		that._queueFile(null, false, next);
	}, function waitForPlay(next) {
		if (that.chunk_count) {
			return next();
		}

		if (that.debug) console.log('Waiting for initial chunk');

		that.once('initial_chunk', next);
	}, function done(err) {

		if (err) {
			if (callback) {
				return callback(err);
			} else {
				return that.emit('error', err);
			}
		}

		that.playcount++;

		if (that.debug) console.log('Play command executed at', Date.now());

		if (callback) callback();
	});
});

/**
 * Destroy this cvlc instance and process
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function destroy() {

	var index;

	this.kill();

	index = instances.indexOf(this);

	// Remove from the instances array
	if (index > -1) {
		instances.splice(index, 1);
	}
});

/**
 * Kill the current cvlc process
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function kill() {

	if (this.debug) console.log('Killing cvlc process');

	if (this.proc && this.proc.kill) {
		this.proc.kill();
	}

	this.playcount = 0;
});

/**
 * Destroy all Cvlc instances and vlc processes
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
function reapAllVlc() {
	for (var i = 0; i < instances.length; i++) {
		instances[i].destroy();
	}
}

// Kill all VLC instances when exiting node
process.on('exit', reapAllVlc);
process.on('SIGINT', reapAllVlc);

module.exports = Cvlc;