/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { persistQueryClient, removeOldestQuery } from '@tanstack/query-persist-client-core'
import { CROWD_HORIZON_MS, type CrowdTree } from './crowd'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-jp'
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
  buster: 'crowd-tree-v3',
  maxAge: CROWD_HORIZON_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const data = query.state.data as CrowdTree | undefined
      return query.queryKey[0] === 'crowd-tree' && query.state.status === 'success'
        && !!data?.buildings.length && data.timestamp * 1000 >= Date.now() - CROWD_HORIZON_MS
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
