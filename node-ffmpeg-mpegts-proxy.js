/*
 * Require libraries
 */
var yargs = require('yargs');
var winston = require('winston');
var http = require("http");
var spawn = require('child_process').spawn;
var fs = require('fs');

/*
 * Read command line options
 */
var argv = yargs
		.usage('Usage: $0 -p <port> [-a <avconv>] [-q] [-s <sources>]')
		.alias('p', 'port')
		.alias('a', 'avconv')
		.alias('s', 'sources')
		.alias('q', 'quiet')
		.demand(['p'])
		.default('a', 'avconv')
		.default('s', 'data/sources.json')
		.describe('p', 'The port the HTTP server should be listening on')
		.describe('a', 'The path to avconv, defaults to just "avconv"')
		.describe('s', 'The path to sources.json, defaults to "data/sources.json"')
		.argv;

/*
 * Configure logger
 */
winston.remove(winston.transports.Console);

// Enable console logging unless the --quiet switch was passed
if (!argv.quiet)
{
	winston.add(winston.transports.Console, {
		timestamp: true,
		colorize: true,
		level: 'debug'
	});
}

/*
 * Read the source definitions
 */
var sources = JSON.parse(fs.readFileSync(argv.sources, 'utf8'));
winston.debug('Loaded ' + sources.length + ' sources');

/**
 * The main HTTP server process
 * @type @exp;http@call;createServer
 */
var server = http.createServer(function (request, response) {
	winston.debug('Got request for "' + request.url + '" from ' + request.connection.remoteAddress);

	// Determine which source to serve based on the requested URL
	var source = null;

	for (var i = 0; i < sources.length; i++)
	{
		if (sources[i].url === request.url)
		{
			source = sources[i];
			break;
		}
	}

	if (source === null)
	{
		winston.info('Unknown source "' + request.url + '" requested');

		response.writeHead(404, {"Content-Type": "text/plain"});
		response.write("404 Not Found\n");
		response.end();

		return;
	}

	// Tell the client we're sending MPEG-TS data
	response.writeHead(200, {
		'Content-Type': 'video/mp2t',
		'Transfer-Encoding': 'chunked'
	});

	// Define options for the child process
	var avconvOptions = [
		'-re',
		'-i', source.source,
		'-vcodec', 'copy',
		'-acodec', 'copy',
		'-metadata', 'service_provider=' + source.provider,
		'-metadata', 'service_name=' + source.name,
		'-f', 'mpegts',
		'-' // Use stdout as output
	];
	
	// Start serving data
	recursiveSpawn(avconvOptions, response);

	// Kill avconv when client closes the connection
	request.on('close', function () {
		winston.info('Client disconnected, stopping avconv');
		avconv.kill();
	});
});

/**
 * Recursively spawns an avconv process with the specified options, then pipes 
 * its output to the response. If the process dies, it is respawned and piping 
 * is continued.
 * @param {type} avconvOptions
 * @param {type} response
 * @returns {undefined}
 */
var recursiveSpawn = function (avconvOptions, response) {
	var avconv = spawn(argv.avconv, avconvOptions);

	// Pipe the process output to the response, but don't end it on EOF
	avconv.stdout.pipe(response, {end: false});

	// Respawn and continue if the process fails
	avconv.stdout.on('end', function () {
		recursiveSpawn(avconvOptions, response);
	});

	// Handle exits
	avconv.on('exit', function (code) {
		var error = 'avconv exited with code ' + code;

		if (code === 255)
			winston.error(error + ', restarting ...');
		else
		{
			winston.error(error + ', aborting ...');
			return;
		}
	});
};

// Start the server
server.listen(argv.port, '::'); // listen on both IPv4 and IPv6
winston.info('Server listening on port ' + argv.port);
