/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { persistQueryClient, removeOldestQuery } from '@tanstack/query-persist-client-core'
import { CROWD_HORIZON_MS, type CrowdResult } from './crowd'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')

const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: CROWD_HORIZON_MS } } })
let storage: Storage | undefined
try {
  storage = window.localStorage
} catch {
  // In-memory caching still works when browser storage is disabled.
}
const [unsubscribe, restored] = persistQueryClient({
  queryClient,
  persister: createAsyncStoragePersister({
    storage, key: 'sfccongestion:crowd:v2', throttleTime: 5000, retry: removeOldestQuery,
  }),
  buster: 'area-scopes-v2',
  maxAge: CROWD_HORIZON_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const data = query.state.data as CrowdResult | undefined
      return query.queryKey[0] === 'crowd' && query.state.status === 'success'
        && data?.status === 'available' && data.point.timestamp * 1000 >= Date.now() - CROWD_HORIZON_MS
    },
  },
})

void restored.catch(() => undefined).then(() => {
  render(() => <QueryClientProvider client={queryClient}><App /></QueryClientProvider>, root!)
})
import.meta.hot?.dispose(() => {
  unsubscribe()
  queryClient.clear()
})
