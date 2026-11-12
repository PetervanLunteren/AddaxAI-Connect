/**
 * Login page
 */
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Callout } from '../components/ui/Callout';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { CODE_INPUT_CLASS, TwoFactorSetup } from '../components/TwoFactorSetup';
import apiClient from '../api/client';
import {
  LoginTwoFactorStep,
  TWO_FACTOR_PENDING_EXPIRED,
  loginWithCode,
  twoFactorErrorMessage,
} from '../api/auth';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, completeLogin } = useAuth();
  const returnTo = searchParams.get('from') || '/dashboard';

  // Set after a correct password when the login needs a second step: a code,
  // or a two-factor setup that a project requires. Null is the password form.
  const [twoFactorStep, setTwoFactorStep] = useState<LoginTwoFactorStep | null>(null);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    apiClient.get('/api/demo-mode')
      .then(res => setIsDemoMode(res.data.demo_mode))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const step = await login(email, password);
      if (step) {
        setTwoFactorStep(step);
        return;
      }
      navigate(returnTo);
    } catch (err: any) {
      if (err.response?.status === 400) {
        if (err.response?.data?.detail === 'LOGIN_USER_NOT_VERIFIED') {
          setError('Please verify your email before logging in. Check your inbox.');
        } else {
          setError('Invalid email or password');
        }
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const backToPassword = (message = '') => {
    setTwoFactorStep(null);
    setCode('');
    setPassword('');
    setError(message);
  };

  // A pending token lasts 15 minutes. When it ran out, start over.
  const handleTwoFactorError = (err: any) => {
    if (err?.response?.data?.detail === TWO_FACTOR_PENDING_EXPIRED) {
      backToPassword(twoFactorErrorMessage(err));
    } else {
      setError(twoFactorErrorMessage(err));
    }
  };

  const finishLogin = async (accessToken: string) => {
    await completeLogin(accessToken);
    navigate(returnTo);
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorStep) return;
    setError('');
    setLoading(true);

    try {
      const response = await loginWithCode(twoFactorStep.pending_token, code, remember);
      await finishLogin(response.access_token);
    } catch (err) {
      handleTwoFactorError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setError('');
    setLoading(true);

    try {
      const res = await apiClient.post('/api/demo-login');
      localStorage.setItem('access_token', res.data.access_token);
      navigate(returnTo);
      window.location.reload();
    } catch {
      setError('Demo login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const backToLoginLink = (
    <div className="text-center text-sm">
      <button
        type="button"
        onClick={() => backToPassword()}
        className="font-medium text-blue-600 hover:text-blue-500"
      >
        Back to login
      </button>
    </div>
  );

  if (twoFactorStep?.two_factor === 'code_required') {
    return (
      <AuthLayout subtitle="Two-factor login">
        <form className="space-y-6" onSubmit={handleCodeSubmit}>
          {error && <Callout variant="error">{error}</Callout>}

          <div>
            <label htmlFor="two-factor-code" className="block text-sm font-medium text-gray-700">
              Code from your authenticator app
            </label>
            <input
              id="two-factor-code"
              name="two-factor-code"
              type="text"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`mt-1 ${CODE_INPUT_CLASS}`}
            />
            <p className="mt-2 text-sm text-gray-500">
              No phone at hand? Type one of your recovery codes.
            </p>
          </div>

          <Checkbox
            id="two-factor-remember"
            checked={remember}
            onChange={setRemember}
            label="Remember this browser for 30 days"
          />

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Checking...' : 'Log in'}
          </Button>

          {backToLoginLink}
        </form>
      </AuthLayout>
    );
  }

  if (twoFactorStep?.two_factor === 'setup_required') {
    return (
      <AuthLayout subtitle="Set up two-factor login">
        <div className="space-y-6">
          <Callout variant="info">
            A project you can open requires two-factor login. Set it up to continue.
          </Callout>
          <TwoFactorSetup
            pendingToken={twoFactorStep.pending_token}
            onDone={(accessToken) => accessToken && finishLogin(accessToken)}
            onFailed={(err) => {
              if (err?.response?.data?.detail === TWO_FACTOR_PENDING_EXPIRED) {
                backToPassword(twoFactorErrorMessage(err));
              }
            }}
            cancel={backToLoginLink}
          />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={isDemoMode ? "Explore the platform with a demo account" : "Sign in to your account"}>
      <div className="space-y-6">
        {error && (
          <Callout variant="error">{error}</Callout>
        )}

        {isDemoMode && (
          <>
            <div>
              <button
                type="button"
                onClick={handleDemoLogin}
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Log in as demo visitor'}
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">or sign in with your account</span>
              </div>
            </div>
          </>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <div className="mt-1">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <div className="mt-1 relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <Link to="/forgot-password" className="font-medium text-blue-600 hover:text-blue-500">
                Forgot your password?
              </Link>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className={`w-full flex justify-center py-2 px-4 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${isDemoMode ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50' : 'border-transparent text-white bg-blue-600 hover:bg-blue-700'}`}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
};
