import router from './router'
import * as k2c from 'koa2-connect'
import * as httpProxy from 'http-proxy-middleware'
import * as queryString from 'query-string'
import * as cheerio from 'cheerio'
import * as request from 'request'
const _request = request.defaults({jar:true});
import { Repository, Module, Interface, Property, ResponseBody } from '../models'
const { genExampleModule, genExampleInterface} = require('./utils/helper')
const proxyConfig:any={
    target: 'https://www.sde4-c.uk.hsbcnet.com', // target host
    changeOrigin: true, // needed for virtual hosted sites
    onProxyRes:(proxyRes:any,req:any,res:any)=>{
        const _end =res.end;
        const originalHeaders = proxyRes.headers;
        const httpStatusCode = proxyRes.statusCode;
        const {mockReq} = req;
        let body='';
        proxyRes.on('data', function (chunk) {
            chunk = chunk.toString('utf-8');
            body += chunk;
        });
        res.write =()=>{};

        res.end =(...endArgs:[])=>{
            //Append original headers
            console.log('originalHeaders',originalHeaders)
            Object.keys(originalHeaders).forEach((key)=>{
               if(key.indexOf('encoding') ===-1 && key.indexOf('connection') === -1){
                   res.setHeader(key, originalHeaders[key]);
               }
            });

            let qs = queryString.parseUrl(req.url);
            console.log('query string', qs.query);

            //Patch GET/POST parameters
            let reqData={
                url:qs.url,
                params:qs.query
            };

            if(req.method !== "GET"){
                //read body
                // let qs = queryString(req.url);
                // console.log('get req', qs);
                Object.assign(req.params,req.body);
            }

            console.log('resp',body);

            if(body.length){
                _end.apply(res, [body]);
            }else{
                _end.apply(res, endArgs);
            }

            //Post response action start
            let utils:SqlUtils = new SqlUtils();
            let createApiData ={
                repo:{
                    creatorId:req.creatorId,
                    ownerId:req.creatorId,
                    name:mockReq.repoName,
                    description:'api desc',
                    members:[],
                    organizationId:null,
                    collaboratorIds:[],
                    memberIds:[]
                },
                module:{},
                interfaceObj:{
                    url:mockReq.url,
                    params:mockReq.params,
                    method:req.method,
                    status:httpStatusCode,
                    description: req.url,
                    resp:body
                }
            };
            utils.createInterface(createApiData);
        };
        proxyRes.on('end',()=>{
            console.log('returning to client...');
            res.end(body);
        });
    },
    selfHandleResponse:true,
    pathRewrite: (path, req)=>{
        return path.replace(/\/record\/(.*)\/(uims|dtc)\/(.*)/,'/$2/$3')
    }
}
router.post('/record/loginhsbcnet', async (ctx, next) => {
    let cam10Res = await cam10(cam10Options(ctx));
    // ctx.body = cam10Res;
    if(cam10Res && cam10Res.message){
        ctx.body = cam10Res;
        return;
    }
    let cam30Res = await cam30(cam10Res);
    if(cam30Res && cam30Res.message){
        ctx.body = cam30Res;
        return;
    }
    if(cam30Res.data){
        let setCookies = cam30Res.data.cookies;
        setCookies && Object.keys(setCookies).map(k=>{
            ctx.cookies.set(k,setCookies[k],{
                path: '/',
                maxAge: 60 * 60 * 1000,
                httpOnly: false
            });
        })
        ctx.body = cam30Res.data.user;
    }else{
        ctx.body= {message:'access landing failed'}
    }
})
router.all('/record/:dataset/:url(.+)', async (ctx, next) => {
    ctx.respond = false
    let creatorId = ctx.session.id;
    ctx.req.body = ctx.request.body;
    ctx.req.creatorId = creatorId;
    let mockParams;
    if(ctx.method === "GET"){
        mockParams = ctx.query;
    }else{
        if(ctx.get('Content-Type') === 'application/x-www-form-urlencoded'){
            mockParams = {...ctx.query, ...ctx.request.body}
        }else if(ctx.get('Content-Type') === 'application/json'){
            mockParams = JSON.stringify(ctx.request.body);
        }else{
            mockParams = ctx.request.body;
        }
    }
    ctx.req.mockReq={
      repoName:ctx.params['dataset'],
      params:mockParams,
      url:ctx.params['url'].substr(0,ctx.params['url'].indexOf(';jsessionid'))
    };

    await k2c(httpProxy(proxyConfig))(ctx, next);
    await next()
})

function transformApiName(req){
    if(req.params["resourceName"]){
        return req.params['resourceName'];
    }
    return req.url;
}

function doRequest(opts){
    console.log('req opts',opts);
    return new Promise(function (resolve, reject) {
        _request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                let {_headers} = response.req;
                resolve({
                    response,
                    body
                });
            } else {
                reject({
                    error,
                    response
                });
            }
        });
    });
}

function cam10Options(ctx){
    let reqForm = ctx.request.body;
    reqForm ={
        env:'4',
        username:'SDE4MXSA11',
        memanswer:'testing1',
        password:'fstffssl'
    };
    let headers = {
        'Content-Type':'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.80 Safari/537.36',
    };
    return {
        url: `https://www.sde${reqForm.env}-c.uk.hsbcnet.com/uims/portal/IDV_CAM10_AUTHENTICATION`,
        method: 'POST',
        headers: headers,
        followAllRedirects:true,
        form: {
            userid:reqForm.username,
            idv_cmd:'idv.Authentication',
            nextPage:'HSBCnet/Landing'
        },
        reqForm
    }
}

async function cam10(opts){
    let resp;
    let headers = {
        'Content-Type':'application/x-www-form-urlencoded',
        'cookie':'SkipWSAPromotional=true',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.80 Safari/537.36',
    };
    let {reqForm} = opts;
    try{
        resp = await doRequest(opts);
    }catch(err){
        console.log('cam10-err',err);
        return {message:'cam10-network'};
    }
    let $ = cheerio.load(resp.body);
    let passDig =$('#passwordCharacters').val();
    if(passDig && passDig.indexOf(',') > -1){
        let pswArray = passDig.split(',');
        let {password} = reqForm;
        let pid = $('input[name=".pid"]').val();
        $('#FIRSTCHAR').val(password.charAt(pswArray[0]-1));
        $('#SECONDCHAR').val(password.charAt(pswArray[1]-1));
        $('#THIRDCHAR').val(password.charAt(pswArray[2]-1));
        $('#memorableAnswer').val('testing1');
        $('#password').val(password.charAt(pswArray[0]-1)+password.charAt(pswArray[1]-1)+password.charAt(pswArray[2]-1));
        let cam30Form = $(`#P_${pid}cam10To30Form`).serialize();
        return {
            url: `https://www.sde${reqForm.env}-c.uk.hsbcnet.com${$(`#P_${pid}cam10To30Form`).attr('action')}`,
            method: 'POST',
            headers,
            followAllRedirects:true,
            form: queryString.parse(cam30Form)
        };
    }else{
        return {message:'cam10-uncaught'};
    }
}

async function cam30(opts){
    let resp;
    try{
        resp = await doRequest(opts);
    }catch(err){
        console.log('err-cam30',err);
        return {message:'cam30-network'};
    }
    if(resp.body.indexOf('logoffURL') > -1 || resp.body.indexOf('.pp=HSBCnet/Landing') > -1){
        let respCookiesStr = resp.response.headers['set-cookie'].map(function (c) { return c.substr(0,c.indexOf(';')) });
        let reqCookiesStr = resp.response.req._headers.cookie.split(';');
        let respCookies={},reqCookies={};
        respCookiesStr.forEach(p=>{
            p = p.split(/\s*=\s*/);
            respCookies[p[0].trim()] = p.splice(1).join('=');
        })
        reqCookiesStr.forEach(p=>{
            p = p.split(/\s*=\s*/);
            reqCookies[p[0].trim()] = p.splice(1).join('=');
        })

        return {
            data:{
                cookies: Object.assign(reqCookies,respCookies),
                user:{
                    jsid: resp.response.req.path.substr(resp.response.req.path.indexOf('=')+1),
                    token:reqCookiesStr['CamToken']
                }
            }};
    }else{
        return {message:'cam30-uncaught'};
    }
}

class SqlUtils{
    transformApiName(req){
        if(req.params["resourceName"]){
            return req.params['resourceName'];
        }
        return req.url;
    }
    async createInterface(data){
        console.log('creating interface',data);

        //Repo & module
        let repo,mod, interf;
        repo = await Repository.findOne({
            where: {name: data.repo.name, creatorId: data.repo.creatorId}
        });
        console.log('repo from db');

        if(repo == null){
            //create a new one
            console.log('no repo found, create new');
            repo = await Repository.create(data.repo);
            mod = await Module.create(genExampleModule({
                creatorId: repo.creatorId,
                repositoryId: repo.id,
            }));
        }else{
            mod = await Module.findOne({
                where:{
                    creatorId: data.repo.creatorId,
                    repositoryId:repo.id
                }
            });
        }


        //Interface
        let allExistingApi = await Interface.findAll({
            where:{
                moduleId:mod.id,
                method:data.interfaceObj.method,
                url:data.interfaceObj.url
            }
        });

        console.log('all existing api',allExistingApi.length);

        if(allExistingApi == null || allExistingApi.length === 0){
            interf = await Interface.create(genExampleInterface(Object.assign({
                name:this.transformApiName(data.interfaceObj),
                method:data.interfaceObj.method,
                reqBody:data.interfaceObj.reqBody,
                creatorId: mod.creatorId,
                moduleId: mod.id,
                repositoryId: mod.repositoryId
            },data.interfaceObj)));
            console.log('created new interface',interf);
            //Save raw response into responseBodes table
            let respoBodyRec = await ResponseBody.create({
                body:data.interfaceObj.resp,
                interfaceId: interf.id,
            });
            console.log('created new raw response');
            //Create
        }else{
            let isMatched = false;
            for(let i=0;i<allExistingApi.length;i++){
                interf = allExistingApi[i];
                //Checking there is same
        /*
         Found, see there is match as:
         Has same parameters list
         Has same parameter and value pair
         */
                // Property.findAll();
            }
        }

        console.log('creating property...')
        const tmpParams = data.interfaceObj.params;
        for (const key of Object.keys(tmpParams)) {
            console.log(key, tmpParams[key]);
            if(key !== '_' && key !== '__nativeApp'&& key !== '__respType'&& key !== '__platform'){
                await Property.create({
                    scope: 'request',
                    name: key,
                    type: 'String',
                    rule: '',
                    value: tmpParams[key],
                    description: '',
                    parentId: -1,
                    creatorId: data.repo.creatorId,
                    interfaceId: interf.id,
                    moduleId: mod.id,
                    repositoryId: repo.id,
                });
            }
        }
    }
}
