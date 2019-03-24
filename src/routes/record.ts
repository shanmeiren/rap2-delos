import router from './router'
import * as k2c from 'koa2-connect'
import * as httpProxy from 'http-proxy-middleware'
import * as queryString from 'query-string'
import { User, Organization, Repository, Module, Interface, Property, QueryInclude, Logger } from '../models'
const { initRepository, initModule,genExampleModule, genExampleInterface} = require('./utils/helper')
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
        console.log('repo from db',repo);

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
                url:data.interfaceObj.url
            }
        });

        console.log('all existing api',allExistingApi.length);

        if(allExistingApi == null || allExistingApi.length === 0){
            interf = await Interface.create(genExampleInterface(Object.assign({
                name:this.transformApiName(data.interfaceObj),
                creatorId: mod.creatorId,
                moduleId: mod.id,
                repositoryId: mod.repositoryId
            },data.interfaceObj)));
            console.log('created new interface',interf);
            //Create
        }else{
            /*
             Destroy if it's matched
             */
            let isMatched = false;
            for(let i=0;i<allExistingApi.length;i++){
                interf = allExistingApi[i];
                // Property.findAll();
            }
        }
        /*
         Found, see there is match as:
         Has same parameters list
         Has same parameter and value pair
         */
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
