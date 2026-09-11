import { useState } from 'react';
import { login, register } from '../api/auth';
import { LogIn, UserPlus, Eye, EyeOff } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: any, token: string) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isLogin) {
        const response = await login(username, password);
        onLoginSuccess(response.user, response.token);
      } else {
        const response = await register(username, password, 'member');
        onLoginSuccess(response.user, response.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md p-8">
        <div className="bg-surface border border-border rounded-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-ui font-semibold text-text-primary mb-2">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="text-text-secondary text-sm">
              {isLogin ? 'Sign in to access your lab inventory' : 'Join to manage your lab inventory'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-status-danger/10 border border-status-danger rounded-sm text-status-danger text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-text-secondary text-sm mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-bg border border-border rounded-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label className="block text-text-secondary text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-bg border border-border rounded-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent pr-12"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                'Processing...'
              ) : isLogin ? (
                <>
                  <LogIn size={18} />
                  Sign In
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  Create Account
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="text-accent hover:text-accent-dim text-sm transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        <div className="mt-4 text-center text-text-secondary text-xs">
          <p>Lab Inventory Management System</p>
        </div>
      </div>
    </div>
  );
}
