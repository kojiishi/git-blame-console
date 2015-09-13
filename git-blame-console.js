var spawn = require('child_process').spawn;
var fs = require('fs');
var path = require('path');
var readline = require('readline');
var args = require('minimist')(process.argv.slice(2));

function repositry(dir) {
  for (;; dir = path.dirname(dir)) {
    try {
      var stats = fs.statSync(path.join(dir, '.git'));
      if (stats && stats.isDirectory())
        return dir;
    } catch (e) {
      // TODO: check ENOENT
    }
    if (dir == '/')
      throw new Error('git repositry not found: ' + filename);
  }
}

function GitFile(pathRelativeToRepositry, hash) {
  this.path = pathRelativeToRepositry;
  this.hash = hash;
  this.lines = [];
}

GitFile.prototype.blame = function () {
  var me = this;
  return new Promise(function (onFullfilled, onRejected) {
    me.blameCore(onFullfilled, onRejected);
  });
}

GitFile.prototype.blameCore = function (onFullfilled, onRejected) {
  var args = ['blame', '-fCCC', this.hash ? this.hash : 'HEAD', '--', this.path];
  console.log(args);
  var blame = spawn('git', args);
  var pattern = /^([0-9a-f]+) (\S+) +\((\S+) +(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+\d{4}) +(\d+)\) (.*)/;
  var me = this;
  readline.createInterface({
    input: blame.stdout,
  }).on('line', function (line) {
    var match = pattern.exec(line);
    if (match) {
      var lineNumber = parseInt(match[5]) - 1;
      me.lines[lineNumber] = {
        hash: match[1],
        path: match[2],
        author: match[3],
        dateTime: match[4],
        text: match[6],
      };
      return;
    }
    console.log('Unkonwn line ignored: ' + line);
  });
  blame.stderr.on('data', function (data) {
    console.log('stderr: ' + data.toString());
  })
  blame.on('close', function (code) {
    console.log('close: ' + code);
    if (code)
      onRejected(code);
    else
      onFullfilled();
  });
}

function GitBlameConsole(filename) {
  this.stack = [];

  var fullPath = path.resolve(filename);
  var root = repositry(path.dirname(fullPath));
  process.chdir(root);
  this.setFile(new GitFile(path.relative(root, fullPath)));

  this.ui = readline.createInterface(process.stdin, process.stdout);
  this.ui.setPrompt('Line number, Enter for next, Back>');
  var me = this;
  this.ui.on('line', function (line) {
    me.onCommand(line);
  });
}

GitBlameConsole.prototype.onCommand = function (line) {
  var num = parseInt(line);
  if (!isNaN(num)) {
    num--;
    if (num >= this.firstLineIndex && num <= this.nextLineIndex) {
      var line = this.file.lines[num];
      console.log(line);
      this.setFile(new GitFile(line.path, line.hash + '^'));
      return;
    }
    this.show(num);
    return;
  }
  switch (line) {
  case '':
    this.show();
    return;
  case 'b':
    this.back();
    return;
  case 'q':
    this.ui.close();
    return;
  default:
    console.log('Unknown command "' + line + '"');
    break;
  }
  this.ui.prompt();
}

GitBlameConsole.prototype.setFile = function (file) {
  if (this.file)
    this.stack.push([this.file, this.firstLineIndex]);
  this.file = file;
  var me = this;
  this.file.blame().then(function () {
    console.log(me.file.lines.length + ' lines\n');
    me.show(0);
  });
}

GitBlameConsole.prototype.show = function (index) {
  var file = this.file;
  if (index === undefined)
    index = this.nextLineIndex;
  this.firstLineIndex = index;
  var lim = Math.min(file.lines.length, index + process.stdout.rows - 1);
  for (; index < lim; index++) {
    var text = (index + 1) + ': ';
    var line = this.file.lines[index];
    if (!line)
      text += '???';
    else
      text += line.hash + ' ' + line.dateTime + ' ' + line.author + ' ' + line.text;
    text = text.substring(0, process.stdout.columns);
    this.ui.output.write(text + '\n');
  }
  this.nextLineIndex = index;
  this.ui.prompt();
}

GitBlameConsole.prototype.back = function () {
  if (this.firstLineIndex) {
    this.show(Math.max(0, this.firstLineIndex - process.stdout.rows + 1));
    return;
  }
  var popped = this.stack.pop();
  if (popped) {
    this.file = popped[0];
    this.show(popped[1]);
    return;
  }
  this.ui.output.write('No more to back\n');
  this.ui.prompt();
}

new GitBlameConsole(args._[0]);
