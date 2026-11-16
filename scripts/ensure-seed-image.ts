import { ensureSeedImage } from '../libraries/server/testing/DatabaseImage'

/*
 * Prepare the immutable database fixture image before a test lane starts.
 *
 * Building or pulling the image is setup, not test execution; keeping it out of
 * the first database test prevents the test timeout from cancelling a cold
 * image build.
 */
await ensureSeedImage()
