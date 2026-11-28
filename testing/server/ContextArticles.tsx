import * as React from 'react'

interface Article {
  title: string,
}

interface Props {
  articles: Article[],
}

/**
 * Renders the request context loaded for this actor.
 * @param props - Server-rendered request context.
 * @param props.articles - Article titles visible to the current actor.
 * @returns The visible article titles.
 */
export const Application = ({ articles }: Props): React.ReactNode => (
  <main data-testid="context-articles">
    {articles.map(article => <p key={article.title}>{article.title}</p>)}
  </main>
)
