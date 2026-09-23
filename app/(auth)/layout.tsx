/**
 * The signed-out screens.
 *
 * These are the only pages a stranger sees, and they used to be a card on a
 * faint two-stop gradient. The lit field and the ruled grid are decoration
 * only — both are drawn on pseudo-elements behind the content, take no pointer,
 * and name nothing, so a screen reader walking this page finds the form and
 * nothing else.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aurora grid-veil h-screen overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  )
}
