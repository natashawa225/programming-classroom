import { ProxyAgent, setGlobalDispatcher } from 'undici'

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  setGlobalDispatcher(
    new ProxyAgent(process.env.HTTPS_PROXY || process.env.HTTP_PROXY!)
  )
}