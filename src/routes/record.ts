import router from './router'
import { Repository, Interface, Property } from '../models'
import { QueryInclude } from '../models';
import Tree from './utils/tree'
import urlUtils from './utils/url'
import * as querystring from 'querystring'
import { Sequelize } from 'sequelize-typescript';

const attributes: any = { exclude: [] }
const pt = require('node-print').pt
const beautify = require('js-beautify').js_beautify
const Op = Sequelize.Op

router.use

// /app/mock/:repository/:method/:url
// X DONE 2.2 支持 GET POST PUT DELETE 请求
// DONE 2.2 忽略请求地址中的前缀斜杠
// DONE 2.3 支持所有类型的请求，这样从浏览器中发送跨越请求时不需要修改 method
router.all('/app/mock/:repositoryId(\\d+)/:url(.+)', async (ctx) => {
  let app: any = ctx.app
  app.counter.mock++
  let { repositoryId, url } = ctx.params
  let method = ctx.request.method
  repositoryId = +repositoryId
  if (REG_URL_METHOD.test(url)) {
    REG_URL_METHOD.lastIndex = -1
    method = REG_URL_METHOD.exec(url)[1].toUpperCase()
    REG_URL_METHOD.lastIndex = -1
    url = url.replace(REG_URL_METHOD, '')
  }

  let urlWithoutPrefixSlash = /(\/)?(.*)/.exec(url)[2]
  // let urlWithoutSearch
  // try {
  // let urlParts = new URL(url)
  // urlWithoutSearch = `${urlParts.origin}${urlParts.pathname}`
  // } catch (e) {
  // urlWithoutSearch = url
  // }
  // DONE 2.3 腐烂的 KISSY
  // KISSY 1.3.2 会把路径中的 // 替换为 /。在浏览器端拦截跨域请求时，需要 encodeURIComponent(url) 以防止 http:// 被替换为 http:/。但是同时也会把参数一起编码，导致 route 的 url 部分包含了参数。
  // 所以这里重新解析一遍！！！

  let repository = await Repository.findById(repositoryId)
  let collaborators: Repository[] = (await repository.$get('collaborators')) as Repository[]
  let itf

  const matchedItfList = await Interface.findAll({
    attributes,
    where: {
      repositoryId: [repositoryId, ...collaborators.map(item => item.id)],
      method,
      url: {
        [Op.like]: `%${urlWithoutPrefixSlash}%`,
      }
    }
  })

  if (matchedItfList) {
    for (const item of matchedItfList) {
      itf = item
      let url = item.url
      if (url.charAt(0) === '/') {
        url = url.substring(1)
      }
      if (url === urlWithoutPrefixSlash) {
        break
      }
    }
  }

  if (!itf) {
    // try RESTFul API search...
    let list = await Interface.findAll({
      attributes: ['id', 'url', 'method'],
      where: {
        repositoryId: [repositoryId, ...collaborators.map(item => item.id)],
        method,
      }
    })

    let listMatched = []
    for (let item of list) {
      if (urlUtils.urlMatchesPattern(url, item.url)) {
        listMatched.push(item)
      }
    }

    if (listMatched.length > 1) {
      ctx.body = { isOk: false, errMsg: '匹配到多个接口，请修改规则确保接口规则唯一性。 Matched multiple interfaces, please ensure pattern to be unique.' }
      return
    } else if (listMatched.length === 0) {
      ctx.body = { isOk: false, errMsg: '未匹配到任何接口 No matched interface' }
      return
    } else {
      itf = await Interface.findById(listMatched[0].id)
    }
  }

  let interfaceId = itf.id
  let properties = await Property.findAll({
    attributes,
    where: { interfaceId, scope: 'response' },
  })
  // check required
  if (~['GET', 'POST'].indexOf(method)) {
    let requiredProperties = await Property.findAll({
      attributes,
      where: { interfaceId, scope: 'request', required: true },
    })
    let passed = true
    let pFailed: Property | undefined
    let params = method === 'GET' ? ctx.request.query : ctx.request.body
    for (const p of requiredProperties) {
      if (typeof params[p.name] === 'undefined') {
        passed = false
        pFailed = p
        break
      }
    }
    if (!passed) {
      ctx.body = {
        isOk: false,
        errMsg: `必选参数${pFailed.name}未传值。 Required parameter ${pFailed.name} has no value.`,
      }
      ctx.status = 500
      return
    }
  }

  properties = properties.map(item => item.toJSON())

  // DONE 2.2 支持引用请求参数
  let requestProperties = await Property.findAll({
    attributes,
    where: { interfaceId, scope: 'request' },
  })
  requestProperties = requestProperties.map(item => item.toJSON())
  let requestData = Tree.ArrayToTreeToTemplateToData(requestProperties)
  Object.assign(requestData, ctx.query)
  const data = Tree.ArrayToTreeToTemplateToData(properties, requestData)
  ctx.type = 'json'
  ctx.body = JSON.stringify(data, undefined, 2)
  if (itf && itf.url.indexOf('[callback]=') > -1) {
    const query = querystring.parse(itf.url.substring(itf.url.indexOf('?') + 1))
    const cbName = query['[callback]']
    const cbVal = ctx.request.query[`${cbName}`]
    if (cbVal) {
      let body = typeof ctx.body === 'object' ? JSON.stringify(ctx.body, undefined, 2) : ctx.body
      ctx.type = 'application/x-javascript'
      ctx.body = cbVal + '(' + body + ')'
    }
  }
})

