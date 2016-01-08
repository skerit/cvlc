var Blast        = __Protoblast,
    Obj          = Blast.Bound.Object,
    Fn           = Blast.Bound.Function,
    instances    = [],
    ChildProcess = require('child_process'),
    portfinder   = require('portfinder'),
    telnet       = require('telnet-client'),
    fs           = require('fs'),
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
	this.options = options;

	// Hinder object, so only 1 instance gets created
	this.hinder = null;

	// The default play mode is 'stream' (over pipes)
	this.play_mode = 'stream';

	// The next mode
	this.next_mode = null;

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
Cvlc.setMethod(function getInstance(callback) {

	var that = this,
	    done,
	    args;

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
			// Get a free port to run the telnet server under
			portfinder.getPort(function gotPort(err, port) {

				if (err) {
					return next(err);
				}

				that.port = port;
				next();
			});
		}, function createProcess(next) {

			var args = [
				'--intf', 'telnet',
				'--telnet-port', that.port,
				'--telnet-password', that.password,
				'-' // Start by listening to the input by default
			];

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
			that.connection = new telnet();

			// Connect to the cvlc telnet interface
			that.connection.connect({
				host: '127.0.0.1',
				port: that.port,
				shellPrompt: '> ',
				password: that.password
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
				next();
			});
		}, function finished(err) {

			if (err) {
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
		that.connection.exec('\n' + command + '\n', callback);
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

	if (optional_file) {
		that.setFile(optional_file);
	}

	Fn.series(function getInstance(next) {
		that.getInstance(next);
	}, function checkMode(next) {

		if (that.play_mode == that.next_mode) {
			return next();
		}

		that.play_mode = that.next_mode;

		// Stop whatever is currently playing
		that.cmd('stop', function stopped(err, response) {

			if (err) {
				return next(err);
			}

			that.cmd('clear', function cleared(err, response) {

				if (err) {
					return next(err);
				}

				if (that.play_mode == 'stream') {
					that.cmd('add -', next);
				} else {
					next();
				}
			});
		});
	}, function playFile(next) {

		if (that.play_mode == 'file') {
			that.cmd('add ' + (that.file_path || that.file_url), next);
		} else {
			that.file_stream.pipe(that.proc.stdin);
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

		if (callback) callback();
	});
});

/**
 * Destroy the process
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Cvlc.setMethod(function destroy() {

	var index;

	if (this.proc && this.proc.kill) {
		this.proc.kill();
	}

	index = instances.indexOf(this);

	// Remove from the instances array
	if (index > -1) {
		instances.splice(index, 1);
	}
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