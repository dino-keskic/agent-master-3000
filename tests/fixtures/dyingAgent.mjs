// An agent that quits on startup the way OpenCode does with a config file it
// cannot load: the reason on stderr, in colour, then exit code 1.
process.stderr.write('\u001b[91m\u001b[1mError: \u001b[0mConfiguration is invalid at /cfg/opencode.json\n↳ Expected string, got 5 model\n');
process.exit(1);
