/**
 * Consumer-facing entrypoint for the shared Basis review policy.
 *
 * Re-exports the reviewer manifest, standard reviewers, Markdown parser/loader,
 * and the overlay composer so a repository can resolve its effective policy
 * from `basis/review`.
 */
export * from '../libraries/review'
