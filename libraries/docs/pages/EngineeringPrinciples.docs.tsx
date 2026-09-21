import { Documentation } from '../components/Documentation'

export class EngineeringPrinciplesDocs extends Documentation<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>Engineering Principles</h1>
          <p>
            These principles describe why Basis engineers software the way it does. They are the
            human-readable philosophy behind the small, versioned reviewer policies that Basis
            shares with consumers, and behind the mechanical rules enforced by ESLint, TypeScript,
            and Knip.
          </p>
          <p>
            They are heuristics for judgment, not theorems. Where a choice depends on scale,
            ownership, intent, or roadmap, the right output of review is often a question rather
            than a verdict.
          </p>
        </section>
        <section>
          <h2>Software has two primary jobs</h2>
          <ol>
            <li>Software must work and meet its specification.</li>
            <li>After correctness, it should be readable and maintainable.</li>
          </ol>
          <p>
            Architecture, abstraction, type systems, patterns, tests, and tooling exist in service
            of those goals. They are not goals in themselves. A straightforward 500-line
            implementation can be better engineering than a 2,500-line "architected" implementation
            when the latter adds indirection without improving correctness, comprehension, reuse,
            testing, or maintenance.
          </p>
        </section>
        <section>
          <h2>Simplicity has value; abstraction has a cost</h2>
          <p>
            Premature abstraction and failure to abstract are opposite mistakes. Junior engineers
            often fail to recognize a reusable concept. Very senior engineers can make the opposite
            mistake: they see abstractions everywhere and build them before the system has
            demonstrated a need.
          </p>
          <p>
            Prefer <strong>emergent reuse</strong>. Abstraction becomes valuable when the pressure
            is real:
          </p>
          <ul>
            <li>behavior or concepts are actually repeated;</li>
            <li>variants genuinely exist;</li>
            <li>
              a clear architectural direction makes imminent reuse concrete rather than
              hypothetical;
            </li>
            <li>independent testability materially improves confidence;</li>
            <li>module, package, or team ownership creates a real boundary;</li>
            <li>change coordination or maintenance cost demonstrates the need.</li>
          </ul>
          <p>
            "We might need this someday" is weak evidence. An abstraction is good when it makes the
            system simpler to understand, reuse, test, or maintain. If it materially increases
            complexity without buying those things, it is probably the wrong abstraction.
          </p>
        </section>
        <section>
          <h2>Decomposition is a means, not a virtue</h2>
          <p>
            Do not split code into the smallest possible functions, classes, or files simply
            because decomposition is fashionable. Group behavior around coherent identities and
            responsibilities. Classes can legitimately represent identity, state, behavior, and
            change over time.
          </p>
          <p>
            Extract a unit when doing so creates useful reuse, a clearer independently
            understandable concept, better testability, or better maintainability. Functional
            decomposition is not inherently superior to object-oriented modeling. Choose the
            representation that best matches the thing being modeled.
          </p>
        </section>
        <section>
          <h2>Reuse should reflect semantics, not syntax</h2>
          <p>
            DRY is about duplicated concepts and responsibilities, not merely repeated lines of
            code. Two code paths may look similar but have different semantics, ownership,
            lifecycles, or reasons to change. Forcing them through one abstraction can be worse
            than duplication.
          </p>
          <p>
            Conversely, when the same semantic responsibility appears more than once, search the
            repository before inventing another helper, abstraction, dependency, service, or
            pattern. Local code and already-adopted dependencies come before introducing parallel
            solutions.
          </p>
        </section>
        <section>
          <h2>Interfaces and contracts are earned</h2>
          <p>
            Concrete dependencies are the default when they keep the system simpler. Do not create
            an <code>IFoo</code> beside every <code>Foo</code> merely because interfaces are
            considered good design.
          </p>
          <p>A contract becomes useful when there is a demonstrated reason:</p>
          <ul>
            <li>meaningful substitution exists or is committed;</li>
            <li>a real architectural, module, or package boundary exists;</li>
            <li>test isolation cannot cheaply use the real collaborator;</li>
            <li>implementations genuinely reuse the capability;</li>
            <li>callers should depend on a capability rather than a particular implementation.</li>
          </ul>
          <p>
            When a contract is needed, shape it around what the consumer needs. A domain capability
            such as <code>ReportStore</code> is often more useful than a generic <code>Database</code> interface
            that merely mirrors <code>PostgresDatabase</code>. Shared method shape alone is not
            shared identity.
          </p>
        </section>
        <section>
          <h2>Substitutability is behavioral</h2>
          <p>
            Type compatibility is not enough. A caller should be able to use an implementation
            through its shared contract without implementation-specific knowledge. If an
            implementation needs stronger preconditions, weakens guarantees, throws for operations
            the contract implies are valid, returns materially different semantics, or forces
            callers to branch on the concrete implementation, the abstraction is lying.
          </p>
          <p>
            Failure is fine when the contract says it can happen and callers are expected to handle
            it. The problem is disagreement between the declared behavioral contract and actual
            behavior.
          </p>
        </section>
        <section>
          <h2>Base classes, interfaces, and composition solve different problems</h2>
          <ul>
            <li>
              Use a base class when multiple concrete implementations should inherit shared default
              behavior.
            </li>
            <li>
              Use an interface when multiple implementations need a common required shape but do
              not share implementation.
            </li>
            <li>
              Use composition or dependency injection when a capability must vary independently of
              the containing object's identity, such as different retry policies in tests versus
              production.
            </li>
          </ul>
          <p>
            Do not follow "favor composition over inheritance" as a religion. If behavior is
            universal and stable, a shared base implementation may be simpler than a
            dependency-injection layer. Avoid inheritance used merely to borrow a helper from an
            unrelated type, and avoid inheritance diamonds.
          </p>
        </section>
        <section>
          <h2>Variation should become architecture only when it actually varies</h2>
          <p>
            A small local <code>switch</code> is often clearer than a strategy, factory, registry,
            or plugin system. Pressure for an extension mechanism appears when variation becomes
            repeated:
          </p>
          <ul>
            <li>the same discriminator is handled in many places;</li>
            <li>adding one variant requires editing several central branches;</li>
            <li>case bodies are repeated variations on a common theme;</li>
            <li>consumers repeatedly need knowledge of every implementation;</li>
            <li>runtime or product requirements make implementations genuinely substitutable.</li>
          </ul>
          <p>
            At that point variation itself has become a reusable concept. Do not build extension
            systems around hypothetical future variants.
          </p>
        </section>
        <section>
          <h2>Keep dependency graphs understandable</h2>
          <p>
            Prefer dependency graphs that are acyclic and generally flow from foundational building
            blocks toward higher-order composition:
          </p>
          <p>
            <code>types / utilities → classes / services → applications / pages</code>
          </p>
          <p>
            Avoid cycles and inheritance diamonds. Do not mistake this for a requirement that every
            project implement formal enterprise layers. Small software can be directly coupled and
            still be excellent software.
          </p>
          <p>
            Stronger package, service, and interface boundaries become valuable as actual
            complexity, reuse, team ownership, testing, or coordination pressure grows. Monoliths
            and monorepos are often the simpler choice until organizational scale makes stronger
            boundaries pay for themselves.
          </p>
        </section>
        <section>
          <h2>Interface segregation should follow reusable capabilities</h2>
          <p>
            Do not split an interface merely because one consumer uses only some of its methods.
            Even many consumers using different subsets does not by itself establish useful
            abstractions.
          </p>
          <p>
            Split when meaningful capability boundaries recur across implementations or concepts:
            for example, several repository-like things share CRUD behavior while several otherwise
            unrelated things are searchable or exportable. The useful abstraction follows reusable
            commonality, not per-consumer slicing.
          </p>
        </section>
        <section>
          <h2>Tests exist to create confidence</h2>
          <p>Tests should prove two things:</p>
          <ul>
            <li>the code does what we think it does;</li>
            <li>the code does not do what we think it does not do.</li>
          </ul>
          <p>
            Important behavior deserves high confidence. Unimportant code may reasonably have
            little or no testing depending on the project and business tradeoff. Use the cheapest
            deterministic test that gives the necessary confidence.
          </p>
          <p>
            For low-level code under our control, direct unit testing should comprehensively
            exercise meaningful branches, positive behavior, negative behavior, and edge conditions
            when doing so is cheap. Use mocks to prove behavior against a collaborator contract. Do
            not build such elaborate mock worlds that the test mostly proves the mocks. When the
            claim is that two real components work together, test the real components together.
          </p>
          <p>
            End-to-end and smoke tests prove properties lower-level tests cannot: the deployed
            application starts, configuration is valid, infrastructure is reachable, login works,
            and critical assembled flows operate. They should generally be fewer because they are
            slower, stateful, expensive, and harder to make deterministic.
          </p>
          <p>
            If important business logic can only be tested by booting the entire application or
            hitting expensive external infrastructure, treat that as architectural signal: a small
            seam may make high-confidence testing cheaper. Comprehensive coverage does not mean
            repeating the same proof at every level. Each higher layer should add signal the lower
            layer cannot provide.
          </p>
        </section>
        <section>
          <h2>Conventions can beat configuration and machinery</h2>
          <p>
            Strong typing is valuable, but it is not automatically worth arbitrary infrastructure
            cost. A small conventional data contract plus validation can be substantially easier to
            maintain than a custom strongly typed DSL or library that requires thousands of lines,
            package publishing, CI/CD coordination, compatibility management, and dependency
            matrices. Prefer convention with enforcement when it gives the same practical safety
            with less machinery.
          </p>
        </section>
        <section>
          <h2>Closed semantic domains should be represented deliberately</h2>
          <p>
            Do not casually allow meaningful domain values to degrade into scattered raw-string
            conventions. If values represent a closed set of cases, encode that fact in the type
            system or another established repository mechanism so that typos, renames,
            exhaustiveness, discovery, and extension are manageable.
          </p>
          <p>
            This principle should eventually be enforced deterministically where possible. It does
            not become a broad semantic reviewer merely because it appears here.
          </p>
        </section>
        <section>
          <h2>Local idiom outranks fashion</h2>
          <p>
            Generic industry best practice is advisory, not authoritative. Review code in the
            context of the repository's established architecture and constraints. Do not recommend
            a fashionable library, hooks pattern, microservice boundary, dependency-injection
            layer, or functional decomposition merely because it is common elsewhere. If we
            intentionally change the local idiom, do so explicitly.
          </p>
        </section>
        <section>
          <h2>Architecture is partly judgment</h2>
          <p>
            Many architectural choices are two-way doors. The purpose of semantic review is often
            to surface a high-value question with relevant repository evidence rather than pretend
            there is a universal theorem. Use findings when the current design is demonstrably
            fighting correctness, readability, or maintainability. Use questions when the code
            shows architectural pressure but intent, roadmap, scale, or ownership determines the
            right answer. That distinction is a feature of the review system, not uncertainty to
            hide.
          </p>
        </section>
        <section>
          <h2>How Basis operationalizes these principles</h2>
          <p>
            Basis turns this philosophy into small, versioned reviewer policies instead of one
            giant architecture reviewer. Each reviewer asks one bounded question and may produce a
            finding, a question, no finding, or abstain.
          </p>
          <ul>
            <li>
              <code>dead-code</code> — do not ship code, exports, or dependencies nothing uses.
            </li>
            <li>
              <code>dryness</code> — do not create a second implementation of a concept the
              repository already expresses.
            </li>
            <li>
              <code>file-responsibility</code> — organize code around understandable units, not
              line counts.
            </li>
            <li>
              <code>readability-over-cleverness</code> — prefer code a future reader can follow.
            </li>
            <li>
              <code>interface-boundaries</code> — concrete by default; contracts are earned.
            </li>
            <li>
              <code>dependency-direction</code> — keep the graph acyclic and flowing from
              foundational to higher-order.
            </li>
            <li>
              <code>single-responsibility</code> — group behavior around a coherent identity.
            </li>
            <li>
              <code>open-closed-design</code> — extend when variation has become repeated.
            </li>
            <li>
              <code>substitutability</code> — implementations must honor the contract's behavior.
            </li>
            <li>
              <code>interface-segregation</code> — split on reusable capability commonality.
            </li>
            <li>
              <code>test-strategy</code> — cheapest deterministic confidence at the lowest useful
              level.
            </li>
            <li>
              <code>composition-vs-inheritance</code> — match the mechanism to the relationship.
            </li>
          </ul>
          <p>The dispositions are deliberately few:</p>
          <ul>
            <li>
              <strong>finding</strong> — enough evidence that something should change now;
            </li>
            <li>
              <strong>question</strong> — architectural pressure whose resolution depends on
              intent, roadmap, scale, or ownership;
            </li>
            <li>
              <strong>no finding</strong> — the candidate is adequately explained or acceptable;
            </li>
            <li>
              <strong>abstain</strong> — the available evidence cannot support the review.
            </li>
          </ul>
        </section>
        <section>
          <h2>Layers of enforcement</h2>
          <p>Every principle lives at the cheapest layer that can carry it:</p>
          <ul>
            <li>
              <strong>This page</strong> — why Basis engineers software this way.
            </li>
            <li>
              <strong>Reviewer policies</strong> — one focused, executable review question each.
            </li>
            <li>
              <strong>Deterministic tooling</strong> — ESLint, TypeScript, Knip, and tests for
              what can be enforced mechanically.
            </li>
            <li>
              <strong>ai-dispatcher evaluation</strong> — whether the semantic reviewers actually
              make the intended judgments.
            </li>
          </ul>
          <p>
            Keeping the philosophy broad and the execution surface narrow is the point. This page
            is not runtime context that every reviewer receives; the reviewer files remain small
            and independently consumable.
          </p>
        </section>
      </>
    )
  }
}
