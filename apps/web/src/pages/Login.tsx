import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../lib/api';
import { isAdminRole, useAuth } from '../lib/auth';

type LocationState = {
  from?: string;
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const user = await login(email, password);
      const locationState = location.state as LocationState | null;
      const fallbackPath = isAdminRole(user.role) ? '/admin' : '/';
      void navigate(locationState?.from ?? fallbackPath, { replace: true });
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div>
          <p className="eyebrow">CherryWiki</p>
          <h1>Login</h1>
          <p className="login-copy">Sign in with an account that has access to this workspace.</p>
        </div>

        {error !== null ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        <form
          className="login-form"
          onSubmit={(event) => {
            void submitLogin(event);
          }}
        >
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button button-primary login-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') {
      return 'Email or password is incorrect.';
    }

    if (error.code === 'ACCOUNT_LOCKED') {
      return 'This account is temporarily locked. Try again later.';
    }

    if (error.code === 'ACCOUNT_DISABLED') {
      return 'This account has been disabled.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to sign in.';
}
