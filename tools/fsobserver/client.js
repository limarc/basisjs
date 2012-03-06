(function(){

 /**
  * @namespace
  */
  var namespace = 'basis.devtools';


  //
  // import names
  //

  var nsDataset = basis.data.dataset;
  var nsProperty = basis.data.property;
  var nsEntity = basis.entity;


  //
  // local vars
  //

  var socket;

  var isReady_ = false;
  var isOnline_ = false;

  var isReady = new nsProperty.Property(isReady_);
  var isOnline = new nsProperty.Property(isOnline_);
  var connectionState = new nsProperty.Property('offline', {
    change: function(state){
      console.log('connection state:', state);
    }
  });


  //
  // init part
  //

  basis.dom.ready(function(){
    // socket.io
    document.getElementsByTagName('head')[0].appendChild(
      basis.dom.createElement({
        description: 'script[src="//' + location.host + ':8222/socket.io/socket.io.js"]',
        load: initServerBackend,
        error: function(){
          //alert('too bad... but also good')
        }
      })
    );
  });

  function initServerBackend(){
    if (typeof io != 'undefined')
    {
      socket = io.connect(':8222');
      isReady.set(isReady_ = true);

      socket.on('connect', function(){
        connectionState.set('online');
      });
      socket.on('disconnect', function(){
        connectionState.set('offline');
        isOnline.set(isOnline_ = false);
      });
      socket.on('connecting', function(){
        connectionState.set('connecting');
      });


      socket.on('newFile', function (data) {
        console.log('new file', data);

        File(data);
      });
      socket.on('updateFile', function (data) {
        console.log('file updated', data);

        File(data);
      });
      socket.on('deleteFile', function (data) {
        console.log('file deleted', data);

        var file = File.get(data);
        if (file)
          file.destroy();
      });
      socket.on('fileSaved', function (data) {
        console.log('file saved', data);
      });
      socket.on('filelist', function (data) {
        console.log('filelist', data.length + ' files');
        File.all.sync(data);
        isOnline.set(isOnline_ = true);
      });
      socket.on('error', function (data) {
        console.log('error:', data.operation, data.message);
      });
    }
  }

  //
  // Main logic
  //

  var File = new nsEntity.EntityType({
    name: namespace + '.File',
    fields: {
      filename: basis.entity.StringId,
      type: String,
      lastUpdate: Date.fromISOString,
      content: String
    }
  });

  File.entityType.entityClass.extend({
    save: function(){
      if (this.modified)
        if (isOnline_)
        {
          socket.emit('saveFile', this.data.filename, this.data.content);
        }
        else
        {
          alert('No connection with server :(');
        }  
    }
  });

  var filesByFolder = new nsDataset.Split({
    source: File.all,
    rule: function(object){
      var path = object.data.filename.split("/");
      path.pop();
      return path.join('/');
    }
  });

  var files = new nsDataset.Subset({
    source: File.all,
    rule: function(object){
      return object.data.type == 'file';
    }
  });

  var filesByType = new nsDataset.Split({
    source: files,
    rule: function(object){
      return object.data.filename.split('.').pop();
    }
  });


  var templateUpdateHandler = {
    update: function(file, delta){
      if ('filename' in delta || 'content' in delta)
      {
        var tempalteFile = basis.template.filesMap[this.data.filename.replace('../templater/', '')];
        if (tempalteFile)
          tempalteFile.update(this.data.content);
      }
    }
  };

  filesByType.getSubset('tmpl', true).addHandler({
    datasetChanged: function(dataset, delta){
      var array;

      if (array = delta.inserted)
        for (var i = 0; i < array.length; i++)
          array[i].addHandler(templateUpdateHandler);

      if (array = delta.deleted)
        for (var i = 0; i < array.length; i++)
          array[i].removeHandler(templateUpdateHandler);
    }
  });


  var linkEl = document.createElement('A');
  document.body.appendChild(linkEl);

  var baseEl = basis.dom.createElement('base');

  function setBase(path){
    linkEl.href = path;                         // Opera and IE doesn't resolve pathes correctly, if base href is not an absolute path
    baseEl.setAttribute('href', linkEl.href);

    basis.dom.insert(document.head, baseEl, 0); // even if there is more than one <base> elements, only first has effect
  }
  function restoreBase(){
    baseEl.setAttribute('href', location);      // Opera left document base as <base> element specified,
                                                // even if this element is removed from document
    basis.dom.remove(baseEl);    
  }

  function deleteImports(imports){
    if (!imports || !imports.length)
      return;

    for (var i = 0; i < imports.length; i++)
    {
      deleteImports(imports[i].imports);
      styleSheetFileMap[imports[i].url].remove(imports[i]);
      basis.dom.remove(imports[i].styleEl);
    }
  }

  function applyStyle(path, content){
  }

  var styleUpdateHandler = {
    update: function(file, delta){
      if ('filename' in delta || 'content' in delta)
      {
        var url = this.data.filename.replace('../templater/', '');
        var fileInfo = styleSheetFileMap[url];

        if (fileInfo)
        {
          styleSheetFileMap[url] = [];
          for (var i = 0, elem; elem = fileInfo[i]; i++)
          {
            deleteImports(elem.imports);
            linearStyleSheet(elem.styleEl, elem.cssFileStack);
          }
        }
      }
    }
  };

  filesByType.getSubset('css', true).addHandler({
    datasetChanged: function(dataset, delta){
      var array;

      if (array = delta.inserted)
        for (var i = 0; i < array.length; i++)
          array[i].addHandler(styleUpdateHandler);

      if (array = delta.deleted)
        for (var i = 0; i < array.length; i++)
          array[i].removeHandler(styleUpdateHandler);
    }
  });

  var styleSheetFileMap = {};
  window.styleSheetFileMap = styleSheetFileMap; // TODO: remove

  function abs2rel(path, base){
    if (base)
    {
      setBase(base);
      linkEl.href = path;
      path = linkEl.href;
      restoreBase();
    }
    else
    {
      linkEl.href = path;
      path = linkEl.href;
    }

    var abs = path.split(/\//);
    var loc = location.href.replace(/\/[^\/]*$/, '').split(/\//);
    var i = 0;

    while (abs[i] == loc[i] && typeof loc[i] == 'string')
      i++;

    return '../'.repeat(loc.length - i) + abs.slice(i).join('/');
  }

  var revisitQueue = [];
  function processRevisitQueue(){
    for (var i = revisitQueue.length; i --> 0;)
    {
      var params = revisitQueue[i];
      var rule = params.rule;
      if (rule.styleSheet)
      {
        console.log('revisit rule styleSheet success', rule.href);
        revisitQueue.splice(i, 1);
        var importSheet = linearStyleSheet(rule.styleSheet, params.insertPoint, params.cssFileStack);
        if (importSheet)
          params.imports.push(importSheet);
      }
      else
      {
        if (params.attempts++ > 10)
        {
          console.log('delete revisit rule, because too many attempts', rule.href);
          revisitQueue.splice(i, 1);
        }
      }  
    }

    if (revisitQueue.length)
      setTimeout(processRevisitQueue, 5);
  }
  function addToRevisitQueue(rule, imports, insertPoint, cssFileStack){
    console.log('add rule to revisit queue', rule.href);

    if (!revisitQueue.search(rule, 'rule'))
    {
      revisitQueue.push({
        attempts: 0,
        rule: rule,
        imports: imports,
        insertPoint: insertPoint,
        cssFileStack: cssFileStack
      });

      if (revisitQueue.length == 1)
        setTimeout(processRevisitQueue, 5);
    }
  }

  var nonObservableFilesCache = {};
  var styleSeed = 0;
  var insertHelper = document.createComment('');

  function linearStyleSheet(styleEl, cssFileStack, url){
    var styleSheet;
    //console.log(styleEl.relPath, ' / ', styleEl.relPath || abs2rel(styleSheet.href), ' / ', styleSheet.href);
    var sheetUrl = url || styleEl.relPath || abs2rel(styleEl.sheet.href);
    var imports = [];
    var content = [];

    if (!cssFileStack)
      cssFileStack = [];
    else
    {
      if (cssFileStack.has(sheetUrl))  // prevent for recursion
      {
        console.warn('prevent recursion for', sheetUrl, cssFileStack);
        return;
      }
    }

    //cssFileStack.push(sheetUrl);

    //
    // fetch style content
    //
    var cssText;
    var cssFile = File.get('../templater/' + sheetUrl);
    if (cssFile)
    {
      cssText = cssFile.data.content;
    }
    else
    {
      cssText = nonObservableFilesCache[sheetUrl];
      if (typeof cssText != 'string')
      {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', sheetUrl, false);
        xhr.send(null);
        
        if (xhr.status >= 200 && xhr.status < 400)
        {
          cssText = xhr.responseText;
          nonObservableFilesCache[sheetUrl] = cssText;
        }
        else
        {
          console.warn('fail to load css content', sheetUrl);
          return;
        }
      }
    }

    //
    // parse content
    //
    setBase(sheetUrl);

    var tmpStyleEl = basis.dom.createElement(
      'style[type="text/css"][seed="' + (styleSeed++) + '"][sourceFile="' + sheetUrl + '?"]',// + (styleSheet.media && styleSheet.media.mediaText ? '[media="' + styleSheet.media.mediaText + '"]' : ''),
      cssText
    );

    document.head.insertBefore(tmpStyleEl, styleEl)
    if (!url)
      basis.dom.remove(styleEl);

    styleEl = tmpStyleEl;
    styleEl.relPath = sheetUrl;

    restoreBase();

    //
    // fetch style sheet again, because it changes on our actions
    //
    styleSheet = styleEl.sheet;

    //
    // process rules
    //
    var rules = styleSheet.cssRules || styleSheet.rules;
    for (var i = rules.length, rule; i --> 0;)
    {
      var rule = rules[i];
      if (rule.type == 3)
      {
        var importSheet = linearStyleSheet(styleEl, cssFileStack.concat(sheetUrl), abs2rel(rule.href, sheetUrl));
        if (importSheet)
          imports.push(importSheet);

        styleSheet.deleteRule(i);
      }
      else
      {
        content.push(rule.cssText);
      }
    }

    if (basis.ua.is('ff') || basis.ua.is('opera'))
    {
      setBase(sheetUrl);
      styleEl.innerHTML = content.join('\n');
      restoreBase();
    }

    //
    // build sheet info
    //

    var sheetInfo = {
      url: sheetUrl,
      styleEl: styleEl,
      imports: imports,
      cssFileStack: cssFileStack
    };

    if (!styleSheetFileMap[sheetUrl])
      styleSheetFileMap[sheetUrl] = [sheetInfo];
    else
      styleSheetFileMap[sheetUrl].push(sheetInfo);


    //
    // return result
    //

    return sheetInfo;
  }


  isOnline.addLink(null, function(value){
    if (value)
      Array.from(document.styleSheets).forEach(function(styleSheet){
        if (styleSheet.ownerNode)
          if (styleSheet.ownerNode.tagName == 'LINK' || styleSheet.ownerNode.relPath)
            linearStyleSheet(styleSheet.ownerNode);
      });
  });

  //
  // export names
  //

  basis.namespace(namespace).extend({
    isReady: isReady,
    isOnline: isOnline,
    connectionState: connectionState,

    File: File,
    filesByFolder: filesByFolder,
    filesByType: filesByType
  });

})();