import { config } from '../lib/config.ts'
import { requireUser } from '../lib/current-user.ts'
import type { CurrentUser } from '../lib/current-user.ts'
import { deleteWhere, findRow, num, selectRows, str, type Row } from '../lib/db.ts'
import { HttpError } from '../lib/errors.ts'
import { json, noContent, pathId } from '../lib/http.ts'
import { artifactDetail, artifactOut } from '../lib/serializers.ts'
import { readBytes, removeObjects } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace } from './workspaces.ts'

const ARTIFACT_COLUMNS = 'id,workspace_id,job_id,kind,title,storage_key,created_at'

async function ownedArtifact(artifactId: number, user: CurrentUser): Promise<Row> {
  const artifact = await findRow('artifacts', [['id', artifactId]], ARTIFACT_COLUMNS)
  if (!artifact) throw new HttpError(404, '生成结果不存在')
  const workspace = await findRow('workspaces', [['id', num(artifact.workspace_id)]], 'id,user_id')
  if (!workspace || num(workspace.user_id) !== user.id) throw new HttpError(404, '生成结果不存在')
  return artifact
}

async function listArtifacts(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const rows = await selectRows<Row>('artifacts', ARTIFACT_COLUMNS, [['workspace_id', workspaceId]], {
    order: 'created_at',
    ascending: false,
  })
  return json(rows.map(artifactOut))
}

async function getArtifact(request: Request, artifactId: number): Promise<Response> {
  const user = await requireUser(request)
  const artifact = await ownedArtifact(artifactId, user)
  const bytes = await readBytes(str(artifact.storage_key), config.artifactMaxBytes)
  const content = new TextDecoder('utf-8').decode(bytes)
  return json(artifactDetail(artifact, content))
}

async function deleteArtifact(request: Request, artifactId: number): Promise<Response> {
  const user = await requireUser(request)
  const artifact = await ownedArtifact(artifactId, user)
  await deleteWhere('artifacts', [['id', artifactId]])
  await removeObjects([str(artifact.storage_key)])
  return noContent()
}

export const artifactRoutes: Route[] = [
  {
    method: 'GET',
    path: '/workspaces/:id/artifacts',
    handler: ({ request, params }) => listArtifacts(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/artifacts/:id',
    handler: ({ request, params }) => getArtifact(request, pathId(params.id)),
  },
  {
    method: 'DELETE',
    path: '/artifacts/:id',
    handler: ({ request, params }) => deleteArtifact(request, pathId(params.id)),
  },
]
