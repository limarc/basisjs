var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var SRC_PATH = '../src/';
var LOG_FILENAME = 'build.log';
var OUTPUT_PATH = path.normalize(path.resolve('.', '../') + '/');

global.document = require('jsdom-nocontextifiy').jsdom();
global.basis = require(SRC_PATH + 'basis').basis;
basis.require('basis.template');

var fileCache = {};
var packages = [];
var asyncCallCount = 0;
var processStart = new Date;

var flags = process.argv.slice(2);
var buildMode = flags.indexOf('-build') != -1;
var packFiles = flags.indexOf('-nopack') == -1;
var srcPathRx = new RegExp('^' + SRC_PATH.forRegExp());
var packageRx = new RegExp(SRC_PATH.forRegExp() + 'package');

function resolveRelPath(filepath){
  return path.relative(OUTPUT_PATH, filepath).replace(/\\/g, '/')
}


function readFile(filepath){
  console.log("read " + filepath);

  var fileContent = fs.readFileSync(filepath, 'utf-8');
  var depends = []; 

  var buildContent = fileContent
    .replace(/;;;.*$/gm, '')
    .replace(/\/\*\*\s*\@cut.*?\*\/.*$/gm, '')
    .replace(/className:\s*(namespace\s*\+\s*)?('|")[a-zA-Z0-9\.\_]+\2,?/g, '')
    .replace(/basis\.require\((['"])([^'"]+)\1\);?/g, function(m, q, path){
      depends.push(path);
      return '';
    });

  fileCache[filepath] = {
    path: filepath,
    srcContent: fileContent,
    buildContent: buildContent,
    depends: depends
  };

  if (packageRx.test(filepath))
    packages.push(fileCache[filepath]);
}

function readfiles(path){
  //console.log('dir [' + path + ']');

  var filelist = fs.readdirSync(path);

  for (var i = 0, filename; filename = filelist[i]; i++)
  {
    var filepath = path + filename;
    var stat = fs.statSync(filepath);
    if (stat.isDirectory())
    {
      if (!/\.svn$/.test(filepath))
        readfiles(filepath + '/');
    }
    else
    {
      if (/\.js$/.test(filepath))
        readFile(filepath);
    }
  }
}

function buildDep(namespace, context){
  if (!context)
    context = {};

  var filename = SRC_PATH + namespace.replace(/\./g, '/') + '.js';

  var cfg = fileCache[filename];
  if (!cfg) console.log(filename);
  var result = {
    files: [],
    srcModules: [],
    buildModules: []
  };

  if (!context[filename])
  {
    context[filename] = 1;

    for (var i = 0, dep; dep = cfg.depends[i]; i++)
    {
      var build = buildDep(dep, context);
      result.files.push.apply(result.files, build.files);
      result.srcModules.push.apply(result.srcModules, build.srcModules);
      result.buildModules.push.apply(result.buildModules, build.buildModules);
    }

    if (buildMode)
    {
      result.srcModules.push(
        "//\n// " + resolveRelPath(filename) + "\n//\n" +
        '{\n' +
        '  ns: "' + namespace + '",\n' + 
        '  path: "' + resolveRelPath(path.dirname(cfg.path)) + '/",\n' + 
        '  fn: "' + path.basename(cfg.path) + '",\n' +
        '  body: function(){' +
             cfg.srcContent + '\n' +
        '  }\n' + 
        '}'
      );

      result.buildModules.push(
        "// " + filename + "\n" +
        '{' +
          '"' + namespace.replace(/^basis\./, '') + '": function(basis, global, __dirname, exports, resource, module, __filename){' +
            //'console.log(arguments)'+
            cfg.buildContent +
          '}' + 
        '}'
      );
    }

    result.files.push(filename);
  }

  return result;
}

function writeLog(data, hideFromConsole){
  var fd = fs.openSync(LOG_FILENAME, 'a');
  fs.writeSync(fd, data + '\n');
  fs.closeSync(fd);

  if (!hideFromConsole)
    console.log(data);
}

function checkForEnd(count){
  asyncCallCount -= count || 0;

  if (!asyncCallCount)
    writeLog('\n=====================\nBuild done in ' + ((new Date - processStart)/1000).toFixed(3) + 's\n');
}

if (path.existsSync(LOG_FILENAME))
  fs.unlinkSync(LOG_FILENAME);

//
// read src files
//
readfiles(SRC_PATH);

writeLog(Object.keys(fileCache).length + ' files read / ' + packages.length + ' packages');
writeLog('==============');

//
// build packages
//
//packages = [packages[0]];
packages.forEach(function(pack){
  var packageFilename = pack.path;

  var namespace = packageFilename
    .replace(srcPathRx, '')
    .replace(/\.js$/g, '')
    .replace(/\//g, '.');

  var packageName = namespace
    .replace(/^package\./g, '')
    .replace(/\./g, '-');

  var packageResFilename = OUTPUT_PATH + 'basis-' + packageName + '.js';
  var packageDebugResFilename = OUTPUT_PATH + 'basis-' + packageName + '-debug.js';
  var build = buildDep(namespace);

  writeLog("\nBuild package `" + packageName + "`:\n  ");
  writeLog(build.files.join('\n'));

  if (buildMode)
  {
    var packStartTime = new Date;
    var packageWrapper = [
      "(function(){\n" +
      "'use strict';" +
      "var __scripts = typeof document != 'undefined' ? document.getElementsByTagName('script') : [];\n" +
      "var __curLocation = __scripts[__scripts.length - 1].src.replace(/[^\/]+\.js$/, '');\n\n",

      "\n})();"
    ];

    var srcContent = [
      packageWrapper[0],
      fileCache[SRC_PATH + 'basis.js'].srcContent,
      '[\n',
        build.srcModules.join(',\n'),
      '].forEach(' + function(module){
         var path = __curLocation + module.path;    
         var fn = path + module.fn;
         var ns = basis.namespace(module.ns);
         ns.source_ = Function.body(module.body);
         ns.filename_ = module.path + module.fn;
         new Function('module, exports, global, __filename, __dirname, basis, resource',
           '/** @namespace ' + ns.path + ' */\n' + ns.source_ + '//@ sourceURL=' + fn
         ).call(ns, ns, ns.exports, this, fn, path, basis, function(url){ return basis.resource(path + url) });
         Object.complete(ns, ns.exports);
       } + ', this)',
      packageWrapper[1]
    ].join('');

    var buildContent = [
      packageWrapper[0],
      fileCache[SRC_PATH + 'basis.js'].buildContent,
      '[\n',
        build.buildModules.join(',\n'),
      '].forEach(' + function(module){
         for (var ns in module)
         {
           var fn = module[ns];
           ns = 'basis.' + ns;
           var nsParts = ns.split(".");
           var filename = nsParts.pop() + '.js';
           var path = __curLocation + 'src/' + nsParts.join('/') + '/';
           var ns = basis.namespace(ns);
           fn.call(ns, basis, this, path, ns.exports, function(url){ return basis.resource(path + url) }, ns, path + filename);
           Object.complete(ns, ns.exports);
         }
       } + ', this)',
      packageWrapper[1]
    ].join('');

    fs.writeFileSync(packageDebugResFilename, srcContent, 'utf-8');

    if (!packFiles)
    {
      fs.writeFileSync(packageResFilename, buildContent, 'utf-8');
    }
    else
    {
      var tmpFilename = packageResFilename + '.tmp';
      fs.writeFileSync(tmpFilename, buildContent, 'utf-8');

      writeLog('init packing for ' + packageResFilename + ' and continue...');

      asyncCallCount++;
      exec('java -jar c:\\tools\\gcc.jar --js ' + tmpFilename, { maxBuffer: 1024 *1024 }, function(error, stdout, stderr){
        writeLog('\n' + packageResFilename + ' packing - done in ' + ((new Date - packStartTime)/1000).toFixed(3) + 's');

        var fileContent = stdout/*.replace(/template:(?:'((?:\\'|[^'])+?)'|"((?:\\"|[^"])+?)")(?=[^\+])/g, function(m, a, b){
          var templateStr = a || b;

          if (!/^[a-z]+:/.test(templateStr))
          {
            var tokens = basis.template.makeDeclaration(templateStr) + '';

            var sqMatch = tokens.match(/\'/g);
            var dqMatch = tokens.match(/\"/g);
            var sqCount = sqMatch ? sqMatch.length : 0;
            var dqCount = dqMatch ? dqMatch.length : 0;

            if (sqCount < dqCount)
              templateStr = "template:'tokens:" + tokens.replace(/'/g, "\\'") + "'";
            else
              templateStr = 'template:"tokens:' + tokens.replace(/"/g, '\\"') + '"';
          }

          return templateStr;
        })*/;

        asyncCallCount++;
        fs.unlink(tmpFilename, function(err){
          console.log('Temp package file ' + tmpFilename + (err ? ' don\'t deleted (' + err + ')' : ' deleted'));
          checkForEnd(1);
        });

        asyncCallCount++;
        fs.writeFile(packageResFilename, fileContent, 'utf-8', function(err){
          console.log('Package file ' + packageResFilename + (err ? ' don\'t saved (' + err + ')' : ' saved'));
          checkForEnd(1);
        });

        writeLog(stderr, true);

        checkForEnd(1);

        if (error !== null){
          console.log('exec error: ' + error);
        }
      });
    }
  }
  else
  {
    var fileContent = ['// Package basis-' + packageName + '.js\n\n!function(){\n\  if (typeof document != \'undefined\')\n\  {\n\    var scripts = document.getElementsByTagName(\'script\');\n\    var curLocation = scripts[scripts.length - 1].src.replace(/[^\\/]+\\.js\$/, \'\');\n'];

    fileContent.push("\n    document.write('<script src=\"' + curLocation + 'src/basis.js\"></script>');\n");
    fileContent.push("\n    document.write('<script src=\"' + curLocation + '" + resolveRelPath(packageFilename) + "\"></script>');\n");
    /*fileContent.push("\n    document.write('<script>');\n");

    var reqFiles = build.files.slice(1, -1);
    var base = path.dirname(build.files[0]);
    for (var i = 0, filename; filename = reqFiles[i]; i++)
    {
      var namespace = path.relative(base, filename).replace(/\.js$/, '').replace(/[\/\\]/g, '.');
      fileContent.push(
        "    document.write('  basis.require(\"" + namespace + "\");');\n"
      );
    }

    fileContent.push("    document.write('</script>');");*/
    fileContent.push("\n  }\n}();");

    fs.writeFileSync(packageDebugResFilename, fileContent.join(''), 'utf-8')
    fs.writeFileSync(packageResFilename, fileContent.join(''), 'utf-8')
  }

});

checkForEnd();