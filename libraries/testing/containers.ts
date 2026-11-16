import { run } from 'basis/utilities'

/** Label marking a Docker resource as owned by a test run. */
const TEST_LABEL = 'basis.test'
/** Label recording the host process that owns the test resource. */
const OWNER_LABEL = 'basis.test.owner'

/** Whether the fixture sweep has already run in this process. */
let swept = false

/**
 * Docker labels applied to every run-scoped test container.
 * @returns The `docker` label arguments.
 */
export function testContainerLabels(): readonly string[] {
  return [
    '--label', `${TEST_LABEL}=1`,
    '--label', `${OWNER_LABEL}=${process.pid}`,
  ]
}

/**
 * Whether one host process is still alive.
 * @param pid - Host process id.
 * @returns `true` when the process exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Remove test containers whose owning test process is gone.
 *
 * This is the SIGKILL safety net: a process cannot handle SIGKILL, so the next
 * test run removes the abandoned labeled containers and their anonymous
 * volumes. Containers owned by a live process are left alone.
 */
export function reapDeadTestContainers(): void {
  if (swept) return
  swept = true
  const ids = run`docker ps -aq --filter ${`label=${TEST_LABEL}=1`}`.lines
  for (const id of ids) {
    const result = run`docker inspect --format ${`{{index .Config.Labels "${OWNER_LABEL}"}}`} ${id}`
    const pid = Number(result.stdout.trim())
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue
    void run`docker rm -f -v ${id}`
  }
}
