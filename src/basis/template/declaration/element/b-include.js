var arrayRemove = basis.array.remove;
var arrayAdd = basis.array.add;
var walk = require('../ast.js').walk;
var utils = require('../utils.js');
var addUnique = utils.addUnique;
var getTokenAttrValues = utils.getTokenAttrValues;
var getTokenAttrs = utils.getTokenAttrs;
var parseOptionsValue = utils.parseOptionsValue;
var refsUtils = require('../refs.js');
var normalizeRefs = refsUtils.normalizeRefs;
var addTokenRef = refsUtils.addTokenRef;
var removeTokenRef = refsUtils.removeTokenRef;
var styleUtils = require('../style.js');
var styleNamespaceIsolate = styleUtils.styleNamespaceIsolate;
var adoptStyles = styleUtils.adoptStyles;
var addStyle = styleUtils.addStyle;
var isolateTokens = styleUtils.isolateTokens;
var applyStyleNamespaces = styleUtils.applyStyleNamespaces;
var attrUtils = require('../attr.js');
var getAttrByName = attrUtils.getAttrByName;
var addRoleAttribute = attrUtils.addRoleAttribute;
var applyShowHideAttribute = attrUtils.applyShowHideAttribute;
var modifyAttr = attrUtils.modifyAttr;
var consts = require('../../const.js');
var TOKEN_TYPE = consts.TOKEN_TYPE;
var TOKEN_BINDINGS = consts.TOKEN_BINDINGS;
var ATTR_NAME = consts.ATTR_NAME;
var TYPE_ATTRIBUTE = consts.TYPE_ATTRIBUTE;
var TYPE_ELEMENT = consts.TYPE_ELEMENT;
var ELEMENT_ATTRIBUTES_AND_CHILDREN = consts.ELEMENT_ATTRIBUTES_AND_CHILDREN;
var CONTENT_CHILDREN = consts.CONTENT_CHILDREN;

var specialTagsAsRegular = ['include', 'content'];
/** @cut */ var attributesWhitelist = ['src', 'no-style', 'isolate', 'options'];
var attributeToInstructionMap = {
  'class': {     // <b:include class=".."> -> <b:append-class value="..">
    instruction: 'append-class',
    valueTo: 'value'
  },
  'id': {        // <b:include id=".."> -> <b:set-attr name="id" value="..">
    instruction: 'set-attr',
    valueTo: 'value',
    attrs: {
      name: 'id'
    }
  },
  'ref': {       // <b:include ref=".."> -> <b:add-ref name="..">
    instruction: 'add-ref',
    valueTo: 'name'
  },
  'show': {      // <b:include show=".."> -> <b:show expr="..">
    instruction: 'show',
    valueTo: 'expr'
  },
  'hide': {      // <b:include hide=".."> -> <b:hide expr="..">
    instruction: 'hide',
    valueTo: 'expr'
  },
  'visible': {   // <b:include visible=".."> -> <b:visible expr="..">
    instruction: 'visible',
    valueTo: 'expr'
  },
  'hidden': {    // <b:include hidden=".."> -> <b:hidden expr="..">
    instruction: 'hidden',
    valueTo: 'expr'
  }
};

function adoptNodes(ast, includeToken){
  walk(ast, function(type, node){
    if (!node.includeToken)
      node.includeToken = includeToken;
  });
}

function applyRole(ast, role/*, sourceToken, location*/){
  walk(ast, function(type, node){
    if (type !== TYPE_ATTRIBUTE || node[ATTR_NAME] != 'role-marker')
      return;

    var roleExpression = node[TOKEN_BINDINGS][1];
    var currentRole = roleExpression[1];

    roleExpression[1] = '/' + role + currentRole;

    /** @cut */ node.sourceToken = arguments[2];
    /** @cut */ node.loc = arguments[3];
  });
}

function clone(value){
  if (Array.isArray(value))
    return value.map(clone);

  if (value && value.constructor === Object)
  {
    var result = {};
    for (var key in value)
      result[key] = clone(value[key]);
    return result;
  }

  return value;
}

function convertAttributeToInstruction(config, attribute){
  return {
    type: TYPE_ELEMENT,
    prefix: 'b',
    name: config.instruction,
    attrs: basis.object.iterate(config.attrs || {}, function(attrName, value){
      return {
        type: TYPE_ATTRIBUTE,
        name: attrName,
        value: value
      };
    }).concat(
      basis.object.complete({
        name: config.valueTo
      }, attribute)
    )
  };
}

module.exports = function(template, options, token, result){
  var elAttrs = getTokenAttrValues(token);
  var elAttrs_ = getTokenAttrs(token);
  var includeStack = options.includeStack;
  var templateSrc = elAttrs.src;

  /** @cut */ if ('src' in elAttrs == false)
  /** @cut */   utils.addTemplateWarn(template, options, '<b:include> has no `src` attribute', token.loc);

  if (!templateSrc)
    return;

  var resource;

  // Add resolve warnings to template warnings list
  // TODO: improve solution with no basis.dev.warn overloading
  /** @cut */ var basisWarn = basis.dev.warn;
  /** @cut */ basis.dev.warn = function(){
  /** @cut */   utils.addTemplateWarn(template, options, basis.array(arguments).join(' '), token.loc);
  /** @cut */   if (!basis.NODE_ENV)
  /** @cut */     basisWarn.apply(this, arguments);
  /** @cut */ };

  if (/^#[^\d]/.test(templateSrc))
  {
    resource = template.templates[templateSrc.substr(1)];
    if (resource)
      resource = options.makeDeclaration(
        clone(resource.tokens),
        resource.baseURI,
        resource.options,
        resource.sourceUrl
      );
  }
  else
  {
    resource = options.resolveResource(templateSrc, template.baseURI);
  }

  // restore patched basis.dev.warn
  /** @cut */ basis.dev.warn = basisWarn;

  if (!resource)
  {
    /** @cut */ utils.addTemplateWarn(template, options, '<b:include src="' + templateSrc + '"> is not resolved, instruction ignored', token.loc);
    return;
  }

  // prevent recursion
  if (includeStack.indexOf(resource) !== -1)
  {
    /** @cut */ var stack = includeStack.slice(includeStack.indexOf(resource) || 0).concat(resource).map(function(res){
    /** @cut */   if (res instanceof options.Template)
    /** @cut */     res = res.source;
    /** @cut */   return res.id || res.url || '[inline template]';
    /** @cut */ });
    /** @cut */ template.warns.push('Recursion: ', stack.join(' -> '));
    return;
  }

  var isolatePrefix = elAttrs_.isolate ? elAttrs_.isolate.value || options.genIsolateMarker() : '';
  var includeOptions = elAttrs.options ? parseOptionsValue(elAttrs.options) : null;
  var decl = options.getDeclFromSource(resource, '', true, basis.object.merge(options, {
    includeOptions: includeOptions
  }));

  adoptNodes(decl.tokens, token);
  template.includes.push({
    token: token,
    resource: resource,
    nested: decl.includes
  });

  if (resource.bindingBridge)
    arrayAdd(template.deps, resource);

  if (decl.deps)
    addUnique(template.deps, decl.deps);

  if (decl.warns)
  {
    /** @cut */ decl.warns.forEach(function(warn){
    /** @cut */   warn.source = warn.source || token;
    /** @cut */ });
    template.warns.push.apply(template.warns, decl.warns);
  }

  /** @cut */ if (decl.removals)
  /** @cut */ {
  /** @cut */   template.removals.push.apply(template.removals, decl.removals);
  /** @cut */   template.removals.forEach(function(item){
  /** @cut */     if (!item.includeToken)
  /** @cut */       item.includeToken = token;
  /** @cut */   });
  /** @cut */ }

  if (decl.resources)
  {
    var resources = decl.resources;

    if ('no-style' in elAttrs)
      // ignore style resource when <b:include no-style/>
      resources = resources.filter(function(item){
        return item.type != 'style';
      });
    else
      adoptStyles(resources, isolatePrefix, token); // TODO: move filter by type here

    // TODO: fix order
    // now {include2-style} {include1-style} {own-style}
    // should be {include1-style} {include2-style} {own-style}
    template.resources.unshift.apply(template.resources, resources);
  }

  // TODO: something strange here
  var styleNSIsolate = {
    /** @cut */ map: options.styleNSIsolateMap,
    prefix: options.genIsolateMarker()
  };

  applyStyleNamespaces(decl.tokens, styleNSIsolate);

  for (var key in decl.styleNSPrefix)
    template.styleNSPrefix[styleNSIsolate.prefix + key] = basis.object.merge(decl.styleNSPrefix[key], {
      /** @cut */ used: Object.prototype.hasOwnProperty.call(options.styleNSIsolateMap, styleNSIsolate.prefix + key)
    });

  // isolate
  if (isolatePrefix)
  {
    isolateTokens(decl.tokens, isolatePrefix);

    /** @cut */ if (decl.removals)
    /** @cut */   decl.removals.forEach(function(item){
    /** @cut */     isolateTokens([item.node], isolatePrefix);
    /** @cut */   });
  }

  var isContentReset = false;
  var instructions = [];
  var tokenRefMap = normalizeRefs(decl.tokens); // ast

  // convert attributes to instructions
  for (var includeAttrName in elAttrs_)
  {
    if (attributeToInstructionMap.hasOwnProperty(includeAttrName))
    {
      instructions.push(
        convertAttributeToInstruction(attributeToInstructionMap[includeAttrName], elAttrs_[includeAttrName])
      );
    }
    else if (includeAttrName === 'role')
    {
      var role = elAttrs_.role.value;

      if (role)
      {
        if (!/[\/\(\)]/.test(role))
        {
          var loc;
          /** @cut */ loc = utils.getLocation(template, elAttrs_.role.loc);
          applyRole(decl.tokens, role, elAttrs_.role, loc);
        }
        /** @cut */ else
        /** @cut */   utils.addTemplateWarn(template, options, 'Value for role was ignored as value can\'t contains ["/", "(", ")"]: ' + role, elAttrs_.role.loc);
      }
    }
    /** @cut */ else if (attributesWhitelist.indexOf(includeAttrName) === -1)
    /** @cut */   utils.addTemplateWarn(template, options, 'Unknown attribute for <b:include>: ' + includeAttrName, elAttrs_[includeAttrName].loc);
  }

  // append instructions
  instructions = instructions.concat(token.children);

  // process instructions
  for (var j = 0, child; child = instructions[j]; j++)
  {
    // process special elements (basis namespace)
    if (child.type == TYPE_ELEMENT && child.prefix == 'b' && specialTagsAsRegular.indexOf(child.name) === -1)
    {
      var childAttrs = getTokenAttrValues(child);
      var ref = 'ref' in childAttrs ? childAttrs.ref : 'element';
      var isSpecialRef = ref.charAt(0) === ':';
      var targetRef = ref && tokenRefMap[ref];
      var target = targetRef && targetRef.node;

      // TODO: split into modules
      switch (child.name)
      {
        case 'style':
          var childAttrs = getTokenAttrValues(child);
          var useStyle = true;

          if (childAttrs.options)
          {
            var filterOptions = parseOptionsValue(childAttrs.options);
            for (var name in filterOptions)
              useStyle = useStyle && filterOptions[name] == includeOptions[name];
          }

          if (useStyle)
          {
            var namespaceAttrName = childAttrs.namespace ? 'namespace' : 'ns';
            var styleNamespace = childAttrs[namespaceAttrName];
            var styleIsolate = styleNamespace ? styleNamespaceIsolate : isolatePrefix;
            var src = addStyle(template, child, childAttrs.src, styleIsolate, styleNamespace);

            if (styleNamespace)
            {
              if (src in styleNamespaceIsolate == false)
                styleNamespaceIsolate[src] = options.genIsolateMarker();

              template.styleNSPrefix[styleNSIsolate.prefix + styleNamespace] = {
                /** @cut */ loc: utils.getLocation(template, getTokenAttrs(child)[namespaceAttrName].loc),
                /** @cut */ used: false,
                name: styleNamespace,
                prefix: styleNamespaceIsolate[src]
              };
            }
          }
          /** @cut */ else
          /** @cut */ {
          /** @cut */   child.sourceUrl = template.sourceUrl;
          /** @cut */   template.resources.push([null, styleIsolate, child, token, childAttrs.src ? false : child.children[0] || true, styleNamespace]);
          /** @cut */ }
          break;

        case 'replace':
        case 'remove':
        case 'before':
        case 'after':
          var replaceOrRemove = child.name == 'replace' || child.name == 'remove';
          var childAttrs = getTokenAttrValues(child);
          var ref = 'ref' in childAttrs || !replaceOrRemove ? childAttrs.ref : 'element';
          var targetRef = ref && tokenRefMap[ref];

          if (targetRef)
          {
            var parent = targetRef.parent;
            var pos = parent.indexOf(targetRef.node);
            if (pos != -1)
            {
              var args = [pos + (child.name == 'after'), replaceOrRemove];

              if (child.name != 'remove')
                args = args.concat(options.process(child.children, template, options));

              parent.splice.apply(parent, args);

              /** @cut */ if (replaceOrRemove)
              /** @cut */   template.removals.push({
              /** @cut */     reason: '<b:' + child.name + '>',
              /** @cut */     removeToken: child,
              /** @cut */     includeToken: token,
              /** @cut */     token: targetRef.node, // for backward capability
              /** @cut */     node: targetRef.node
              /** @cut */   });
            }
          }
          break;

        case 'prepend':
        case 'append':
          if (target && target[TOKEN_TYPE] == TYPE_ELEMENT)
          {
            var children = options.process(child.children, template, options);

            if (child.name == 'prepend')
              target.splice.apply(target, [ELEMENT_ATTRIBUTES_AND_CHILDREN, 0].concat(children));
            else
              target.push.apply(target, children);
          }
          break;

        case 'show':
        case 'hide':
        case 'visible':
        case 'hidden':
          if (target && target[TOKEN_TYPE] == TYPE_ELEMENT)
          {
            var expr = getTokenAttrs(child).expr;

            if (!expr)
            {
              /** @cut */ utils.addTemplateWarn(template, options, 'Instruction <b:' + child.name + '> has no `expr` attribute', child.loc);
              break;
            }

            applyShowHideAttribute(template, options, target, basis.object.complete({
              name: child.name,
            }, getTokenAttrs(child).expr));
          }
          break;

        case 'attr':
        case 'set-attr':
          modifyAttr(template, options, token, target, child, false, 'set');
          break;

        case 'append-attr':
          modifyAttr(template, options, token, target, child, false, 'append');
          break;

        case 'remove-attr':
          modifyAttr(template, options, token, target, child, false, 'remove');
          break;

        case 'class':
        case 'append-class':
          modifyAttr(template, options, token, target, child, 'class', 'append');
          break;

        case 'set-class':
          modifyAttr(template, options, token, target, child, 'class', 'set');
          break;

        case 'remove-class':
          var valueAttr = getTokenAttrs(child).value;

          // apply namespace prefix for values
          if (valueAttr)
          {
            valueAttr.value = valueAttr.value
              .split(/\s+/)
              .map(function(name){
                return name.indexOf(':') > 0 ? styleNSIsolate.prefix + name : name;
              })
              .join(' ');

            if (valueAttr.binding)
              valueAttr.binding.forEach(function(bind){
                if (bind[0].indexOf(':') > 0)
                  bind[0] = styleNSIsolate.prefix + bind[0];
              });

            // probably should be removed, as map_ is not used
            if (valueAttr.map_)
              valueAttr.map_.forEach(function(item){
                if (item.value.indexOf(':') > 0)
                  item.value = styleNSIsolate.prefix + item.value;
              });
          }

          modifyAttr(template, options, token, target, child, 'class', 'remove-class');
          break;

        case 'add-ref':
          var refName = (childAttrs.name || '').trim();

          if (!target)
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Target node for <b:' + child.name + '> is not found', child.loc);
            break;
          }

          if (isSpecialRef)
          {
            /** @cut */ utils.addTemplateWarn(template, options, '<b:' + child.name + '> can\'t to be applied to special reference `' + ref + '`', child.loc);
            break;
          }

          if (!/^[a-z_][a-z0-9_]*$/i.test(refName))
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Bad reference name for <b:' + child.name + '>: ' + refName, child.loc);
            break;
          }

          addTokenRef(target, refName);
          break;

        case 'remove-ref':
          var refName = (childAttrs.name || '').trim();
          var ref = 'ref' in childAttrs ? childAttrs.ref : refName || 'element';
          var isSpecialRef = ref.charAt(0) === ':';
          var targetRef = ref && tokenRefMap[ref];
          var target = targetRef && targetRef.node;

          if (!target)
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Target node for <b:' + child.name + '> is not found', child.loc);
            break;
          }

          if (isSpecialRef)
          {
            /** @cut */ utils.addTemplateWarn(template, options, '<b:' + child.name + '> can\'t to be applied to special reference `' + ref + '`', child.loc);
            break;
          }

          if (!/^[a-z_][a-z0-9_]*$/i.test(refName))
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Bad reference name for <b:' + child.name + '>: ' + refName, child.loc);
            break;
          }

          removeTokenRef(target, refName || ref);
          break;

        case 'role':
        case 'set-role':
          var name = childAttrs.name;

          if (!name && 'value' in childAttrs)
          {
            /** @cut */ utils.addTemplateWarn(template, options, '`value` attribute for <b:' + child.name + '> is deprecated, use `name` instead', getTokenAttrs(child).value.loc);
            name = childAttrs.value;
          }

          if (!target)
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Target node for <b:' + child.name + '> is not found', child.loc);
            break;
          }

          arrayRemove(target, getAttrByName(target, 'role-marker'));
          addRoleAttribute(template, options, target, name || '', child);
          break;

        case 'remove-role':
          if (!target)
          {
            /** @cut */ utils.addTemplateWarn(template, options, 'Target node for <b:' + child.name + '> is not found', child.loc);
            break;
          }

          arrayRemove(target, getAttrByName(target, 'role-marker'));
          break;

        default:
          /** @cut */ utils.addTemplateWarn(template, options, 'Unknown instruction tag: <b:' + child.name + '>', child.loc);
      }
    }
    else
    {
      var targetRef = tokenRefMap[':content'];
      var processedChild = options.process([child], template, options);

      if (targetRef)
      {
        var parent = targetRef.parent;
        var pos = parent.indexOf(targetRef.node);

        if (!isContentReset)
        {
          isContentReset = true;

          /** @cut */ for (var i = CONTENT_CHILDREN; i < targetRef.node.length; i++)
          /** @cut */   template.removals.push({
          /** @cut */     reason: 'node from including template',
          /** @cut */     removeToken: child,
          /** @cut */     includeToken: token,
          /** @cut */     token: targetRef.node[i], // for backward capability
          /** @cut */     node: targetRef.node[i]
          /** @cut */   });

          targetRef.node.splice(CONTENT_CHILDREN);
        }

        targetRef.node.push.apply(targetRef.node, processedChild);
      }
      else
      {
        decl.tokens.push.apply(decl.tokens, processedChild);
      }
    }
  }

  if (tokenRefMap.element)
    removeTokenRef(tokenRefMap.element.node, 'element');

  result.push.apply(result, decl.tokens);
};
