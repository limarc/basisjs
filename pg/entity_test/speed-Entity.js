    var DOM = Basis.DOM;
    var Data = Basis.Data;
    var nsWrapers = DOM.Wrapper;
    var nsEntity = Basis.Entity;

    var eventStat = {};
    var _dispatch = Basis.EventObject.prototype.dispatch.method;
    Basis.EventObject.prototype.dispatch.method = function(eventName){
      eventStat[eventName] = (eventStat[eventName] || 0) + 1;
      _dispatch.apply(this, arguments);
    }
    var addCount = 0;
    var removeCount = 0;
    var _add = Basis.EventObject.prototype.addHandler.method;
    Basis.EventObject.prototype.addHandler.method = function(){
      addCount++;
      return _add.apply(this, arguments);
    }/*
    var _remove = Basis.EventObject.prototype.removeHandler.method;
    Basis.EventObject.prototype.removeHandler.method = function(){
      removeCount++;
      _remove.apply(this, arguments);
    }*/

    function saveEventStat(){
      savedEventStat_ = Object.extend({}, eventStat);
    }
    function getEventStat(){
      var res = {};
      for (var event in eventStat)
      {
        if (eventStat[event] != savedEventStat_[event])
          res[event] = eventStat[event] - (savedEventStat_[event] || 0);
      }
      return res;
    }

    Function.$nullOrValue = function(value){
      return value == null ? null : value;
    };

    Function.$nullOrString = function(value){
      return value == null ? null : String(value);
    };

    Function.$nullOrBoolean = function(value){
      return value == null ? null : Boolean(value);
    };

    Function.$date = function(value){
      return value instanceof Date || value == null ? value : Date.fromISOString(value);
    };

    Function.$nullOrArray = function(value){
      return value == null || value.length == 0 ? null : Array.from(value);
    }

    var User = new nsEntity.EntityType({
      name: 'User',
      id: 'UserId',
      fields: {
        UserId: Function.def(Number, null, isNaN),
        Title: String,
        Value: Number
      }
    });

    var Currency = new nsEntity.EntityType({
      name: 'Currency',
      id: 'CurrencyId',
      fields: {
        CurrencyId: Function.def(Number, null, isNaN),

        Code: String,
        Title: String
      }
    });

    var Transfer = new nsEntity.EntityType({
      name: 'Transfer',
      id: 'TransferId',
      fields: {
        TransferId: Function.def(Number, null, isNaN),
        User: User,
        Amount: Number,
        Currency: Currency,
        Value: Number,
        CreateDate: Function.$date
      }
    });

    var MAX_COUNT = 1000;
    var MAX_COUNT_QUATER = MAX_COUNT >> 2;

    var date = new Date();
    function test(){
      var st = Date.now();
      for (var i = 1; i <= MAX_COUNT; i++)
      {
        Transfer({
          TransferId: i,
          User: {
            UserId: 1 + (i % MAX_COUNT_QUATER),
            Title: 'User #' + (i % MAX_COUNT_QUATER)
          },
          Amount: i,
          Currency: 1 + (i % 5),
          CreateDate: date
        });
      }
      return Date.now() - st;
    }

    function test_fast_insert(){
      var st = Date.now();
      var data = [];
      for (var i = 1; i <= MAX_COUNT; i++)
      {
        data.push({
          TransferId: i,
          User: {
            UserId: 1 + (i % MAX_COUNT_QUATER),
            Title: 'User #' + (i % MAX_COUNT_QUATER)
          },
          Amount: i,
          Currency: 1 + (i % 5),
          CreateDate: date
        });
      }
      Transfer.all.sync(data);
      return Date.now() - st;
    }


    var uniqValue = 1;
    function test_update(){
      var st = Date.now();
      for (var i = 1; i <= MAX_COUNT; i++)
      {
        Transfer({
          TransferId: i,
          User: {
            Value: Math.random()
          },
          Value: uniqValue++,
          Currency: {
            Title: 'Currency ' + 1 + (i % 5)
          }
        });
      }
      return Date.now() - st;
    }


    function getCount(es){
      if (es.value)
        return es.value.length;
      if (es.items)
        return es.items.length;
      return es.itemCount;
    }
    function clear(){
      var st = Date.now();
      for (var i = 1, cnt = getCount(Transfer.all); i <= cnt; i++)
        Transfer(i).destroy();
      for (var i = 1, cnt = getCount(Currency.all); i <= cnt; i++)
        Currency(i).destroy();
      for (var i = 1, cnt = getCount(User.all); i <= cnt; i++)
        User(i).destroy();
      return Date.now() - st;
    }

    function fast_clear(){
      if (1 && Transfer.all.sync)
      {
        var st = Date.now();
        Transfer.all.sync([]);
        User.all.sync([]);
        Currency.all.sync([]);
        return Date.now() - st;
      }
      else
        return clear();
    }

    var cold_insert = 0;
    var hot_update = 0;
    var hot_update_changes = 0;
    var clear_time = 0;
    var fast_clear_time = 0;

    function run1(func){
      saveEventStat();
      var t1 = test(); var s1 = summary(); var es1 = getEventStatElement();
      saveEventStat();
      var t2 = test(); var s2 = summary(); var es2 = getEventStatElement();
      saveEventStat();
      var t22 = test_update(); var s3 = summary(); var es3 = getEventStatElement();
      saveEventStat();
      var t3 = clear(); var s4 = summary(); var es4 = getEventStatElement();

      cold_insert += t1;
      hot_update += t2;
      hot_update_changes += t22;
      clear_time += t3;

      DOM.insert(document.body, [
        DOM.createElement('hr'),
        DOM.createElement(null, '1st run: ', '{0:.3} sec'.format(t1/1000), s1, es1),
        DOM.createElement(null, '2nd run (no changes): ', '{0:.3} sec'.format(t2/1000), s2, es2),
        DOM.createElement(null, '3rd run (changes): ', '{0:.3} sec'.format(t22/1000), s3, es3),
        DOM.createElement(null, 'Clear all: ', '{0:.3} sec'.format(t3/1000), s4, es4)
      ]);
      setTimeout(func, 200);
    }

    function run2(func){
      saveEventStat();
      var t1 = test_fast_insert(); var s1 = summary(); var es1 = getEventStatElement();
      saveEventStat();
      var t2 = test_fast_insert(); var s2 = summary(); var es2 = getEventStatElement();
      saveEventStat();
      var t22 = test_update(); var s3 = summary(); var es3 = getEventStatElement();
      saveEventStat();
      var t3 = fast_clear(); var s4 = summary(); var es4 = getEventStatElement();

      cold_insert += t1;
      hot_update += t2;
      hot_update_changes += t22;
      fast_clear_time += t3;

      DOM.insert(document.body, [
        DOM.createElement('hr'),
        DOM.createElement(null, '1st run: ', '{0:.3} sec'.format(t1/1000), s1, es1),
        DOM.createElement(null, '2nd run (no changes): ', '{0:.3} sec'.format(t2/1000), s2, es2),
        DOM.createElement(null, '3rd run (changes): ', '{0:.3} sec'.format(t22/1000), s3, es3),
        DOM.createElement(null, 'Fast clear all: ', '{0:.3} sec'.format(t3/1000), s4, es4)
      ]);
      setTimeout(func, 200);
    }

    function summary(){
      return DOM.createElement({
          description: 'SPAN',
          css: {
            display: 'block',
            color: '#888',
            fontSize: '10px',
            padding: '0 2ex'
          }
        },
        [Transfer.all, Currency.all, User.all].map(function(ds, idx){ return ['Transfer', 'Currency', 'User'][idx] + ' ' + getCount(ds) }).join(', ')
      );
    }

    function getEventStatElement(){
      var res = getEventStat();
      return DOM.createElement({
          description: 'SPAN',
          css: {
            display: 'block',
            color: '#D00',
            fontSize: '10px',
            padding: '0 2ex'
          }
        },
        Object.iterate(res, String.format, '{0}: +{1}').sort().join(', ')
      );
    }

    function total(){
      DOM.insert(document.body, [
        DOM.createElement('hr'),
        DOM.createElement('H2', 'SCORE: ', '{0:.0}'.format((cold_insert+hot_update+hot_update_changes + 2*clear_time + 2*fast_clear_time)/4)),
        DOM.createElement(null, 'First run: ', '{0:.3} sec'.format(cold_insert/4000)),
        DOM.createElement(null, 'Second run (no changes): ', '{0:.3} sec'.format(hot_update/4000)),
        DOM.createElement(null, 'Second run (changes): ', '{0:.3} sec'.format(hot_update_changes/4000)),
        DOM.createElement(null, 'Clear total: ', '{0:.3} sec'.format(clear_time/2000)),
        DOM.createElement(null, 'Fast clear total: ', '{0:.3} sec'.format(fast_clear_time/2000))
      ]);
    }

    function run_test(){
      run1(function(){
        run1(function(){
          var c1 = Transfer.createCollection('col1', Data('getId()%2'), Transfer.all);
          var c2 = User.createCollection('col2', Data('getId()%2'), User.all);
          DOM.insert(document.body, [
            DOM.createElement('hr'),
            DOM.createElement(null, '2 collection added')
          ]);
          run2(function(){
            run2(function(){
              total();
            });
          });
        });
      });
    }

    DOM.insert(document.body,
      DOM.createElement({
        description: 'BUTTON',
        click: function(){
          DOM.remove(this);
          run_test();
        }
      }, 'run test')
    );
