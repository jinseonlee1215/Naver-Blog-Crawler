'use strict'

const cheerio = require('cheerio');
const request = require('request');
const mysql = require('mysql');
const fs = require('fs');
const Iconv = require('iconv').Iconv;
const Flowpipe = require('flowpipe');

const delay = 100;
const randomDelay = 300;
const crawlerSetting = {
  query: '',
  startRegion: 0,
  page: 1,
  mysql: {
    "host": "",
    "user": "",
    "password": "",
    "database": ""
  },
}

if(process.argv.length < 3) {
    console.log('node app.js [ keyword ]');
    return;
}

crawlerSetting.query = process.argv[2];


let processing = ()=> {
  let app = {};

  app.connectDB = (args) => new Promise((resolve)=> {
    args.connect = mysql.createConnection(args.options.mysql);
  });

  app.getRegion = (args) => new Promise((resolve)=> {
    args.connect.query('SELECT lv_1, lv_2 FROM region WHERE lv_2 != "" GROUP BY lv_1, lv_2 LIMIT ?, 1000;', [args.options.startRegion], function (err, res) {
      if (err)
        throw err;

      resolve({region: res, regionIndex: 0});
    });
  });

  app.getSearchList = (args) => new Promise((resolve)=> {
    let {region, regionIndex} = args;
    let {query, page} = args.options;

    let url = `http://search.naver.com/search.naver?where=post&sm=tab_pge&query=${encodeURI(region[regionIndex].lv_1 + ' ' + region[regionIndex].lv_2 + query)}&st=sim&date_option=0&date_from=&date_to=&dup_remove=1&post_blogurl=&post_blogurl_without=&srchby=all&nso=&ie=utf8&start=${page}`;
    let searchList = [];

    request.get({
          url: url,
          headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'cookie': 'npic=HtebGYjA5Fa84Y2pu3/RLgqr6A4V8jD4OHkQRDvVzD855YQt6q7gb87gE8xeSVpXCA==; NNB=J42IIS4SJONFO; _ga=GA1.2.497966488.1471873770; nx_ssl=2; nx_res=s1%3DB188%2Cs2%3D10BF%2Cac%3DC851; nid_iplevel=1; page_uid=TuHWdlpySo0sssJx2R4sssssssK-456346; _naver_usersession_=YAvI/xMBCMHH/do95+z4MA==',
            'referer': 'https://search.naver.com/search.naver?where=post&sm=tab_pge&query=' + encodeURI(region[regionIndex].lv_1 + ' ' + region[regionIndex].lv_2 + query) + '&st=sim&date_option=0&date_from=&date_to=&dup_remove=1&post_blogurl=&post_blogurl_without=&srchby=all&nso=&ie=utf8&start=' + (page > 10) ? page - 10 : 0,
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36'
          },
          jar: jar
        },
        function (err, res, body) {
          if (err)
            throw err;

          let $ = cheerio.load(body);

          $('ul > li > dl > dt > a').each(function () {
            let url = $(this).attr('href');
            let title = $(this).attr('title');

            searchList.push({title: title, url: url});
          });

          if (body.search(/보안 절차를 통과하면 검색 서비스를 정상적으로 이용하실 수 있습니다/gim) != -1) {
            console.log(body);
            return;
          }


          resolve({
            getIFrameUrlIndex: 0,
            getIFrameUrlEnd: searchList.length,
            searchList: searchList
          });
        }
    );
  });

  app.getBlogHtml = (args) => new Promise((resolve)=> {
    let {getIFrameUrlIndex, searchList, region, regionIndex, options} = args;
    if (searchList[getIFrameUrlIndex] == null) {
      resolve({callbackCtrl: false});
      return;
    }
    let url = searchList[getIFrameUrlIndex].url + '';

    request.get({
      url: url,
      encoding: 'binary',
      headers: {
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.71 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.6,en;q=0.4',
      }
    }, function (err, res, body) {
      if (err) {
        resolve({callbackCtrl: false});
        return;
      }

      try {
        let ic = new Iconv('CP949', 'utf-8//IGNORE');

        body = new Buffer(body, 'binary');
        body = ic.convert(body).toString();
      } catch (err) {
        throw err;
      }

      let $ = cheerio.load(body);
      let title, content = '', date, category = [], comment = [];

      if ($('.htitle').length != 0) {
        title = $('.htitle > span.pcol1.itemSubjectBoldfont').text().replace(/^\s+|\s+$/g, '');
        date = $('.date.fil5.pcol2._postAddDate').text().replace(/^\s+|\s+$/g, '');

        $('.htitle > span > a.pcol2').each(function () {
          category.push($(this).text().replace(/^\s+|\s+$/g, ''));
        });
        $('div#postViewArea p').each(function () {
          content += $(this).find('span').text() + '<br>';
        })
        $('div#comment.comment > ul#commentList.cmlist.type > li._countableComment > dl').each(function(){
          if($(this).find('dd.comm.pcol2').text().search(/비밀 댓글입니다./g) != -1){
            comment.push({
              name : $(this).find('dt.h > .nick.pcol2').text(),
              date : $(this).find('dt.h > span.date.fil5.pcol2').text(),
              content : $(this).find('dd.comm.pcol2').text(),
            });
          }
        })
      }
      else if ($('.se_component_wrap').length != 0) {
        title = $('.se_editView.se_title > .se_textView > .se_textarea').text().replace(/^\s+|\s+$/g, '');
        date = $('.se_publishDate.pcol2.fil5').text().replace(/^\s+|\s+$/g, '');

        $('.se_series > a.pcol2').each(function () {
          category.push($(this).text().replace(/^\s+|\s+$/g, ''));
        });
        $('.se_component_wrap.sect_dsc.__se_component_area span').each(function () {
          if ($(this).text())
            content += $(this).text() + '<br>';
        })
        $('div#comment.comment > ul#commentList.cmlist.type > li._countableComment > dl').each(function(){
          if($(this).find('dd.comm.pcol2').text().search(/비밀 댓글입니다./g) != -1){
            comment.push({
              name : $(this).find('dt.h > .nick.pcol2').text(),
              date : $(this).find('dt.h > span.date.fil5.pcol2').text(),
              content : $(this).find('dd.comm.pcol2').text(),
            });
          }
        })

      } else {
        let url = $('frame').attr('src');

        if (!url) {
          resolve({callbackCtrl: false});
          return;
        }

        if (url.indexOf('http') != 0)
          url = 'http://blog.naver.com' + url;

        searchList[getIFrameUrlIndex].url = url;
        resolve({callbackCtrl: true});
        return;
      }

      resolve({
        callbackCtrl: false,
        data: {
          blogURL: url,
          title: title,
          content: content,
          comment: JSON.stringify(comment),
          date: date,
          category: JSON.stringify(category),
          query: `${region[regionIndex].lv_2}, ${region[regionIndex].lv_1}, ${options.query}`
        }
      });
    });
  });

  app.intaval = (args) => new Promise((resolve) =>{
    setTimeout(resolve, delay + Math.random() * randomDelay);
  });

  app.saveDB = (args) => new Promise((resolve)=> {
    let {getIFrameUrlIndex, data} = args;

    args.connect.query('INSERT INTO blogreview SET ?', [data], function (err) {
      let d = new Date().toLocaleTimeString();
      if (err) {
        console.log(`[${d}] failed : ${(args.options.page + getIFrameUrlIndex)} / ${(data ? data.blogURL : 'undefined')} ${err}`);
        resolve();
        return;
      }

      console.log(`[${d}] insert : ${(args.options.page + getIFrameUrlIndex)} / ${(data ? data.blogURL : 'undefined')}`);
      resolve();
    });
  });

  app.closeDB = (args) => new Promise((resolve)=> {
    args.connect.end();
  });

  return app;
};

let {connectDB, getRegion, getSearchList, getBlogHtml, intaval, saveDB, closeDB} = processing();
let jar = request.jar();

let crawler = Flowpipe.instance('work');
crawler
    .init((args)=> args.options = crawlerSetting)
    .init(connectDB)
    .then('getRegion', getRegion)
    .then('getSearchList', getSearchList)
    .log((args)=> `${args.options.startRegion + args.regionIndex} : ${args.region[args.regionIndex].lv_1} ${args.region[args.regionIndex].lv_2} ${args.options.page}`)
    .then('getBlogHtml', getBlogHtml)
    .then(intaval)
    .loop('getBlogHtml', (args)=> args.callbackCtrl === true)
    .then(saveDB)
    .loop('getBlogHtml', (args)=> ++args.getIFrameUrlIndex < args.getIFrameUrlEnd)
    .init((args)=> args.options.page += args.getIFrameUrlEnd)
    .loop('getSearchList', (args)=> args.getIFrameUrlEnd >= 10 && args.options.page <= 500)
    .init((args)=> args.options.page = 1)
    .loop('getSearchList', (args)=> ++args.regionIndex < args.region.length)
    .then(closeDB)
    .run();
