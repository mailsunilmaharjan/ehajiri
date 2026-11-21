// Router shim. The Accounts screens were written with absolute paths ('/ledger', '/docs/SI/new' …) for a
// stand-alone app. Inside eHajiri they live under /accounts, so Link / navigate() add that prefix and
// useLocation() hides it — the screens keep working unchanged and the browser URL becomes /accounts/ledger
// (real deep links, back button and refresh all work).
import { forwardRef, useCallback } from 'react';
import * as RR from 'react-router-dom';

export const PREFIX = '/accounts';
const withPrefix = (to) => {
  if (typeof to === 'string') return to.startsWith('/') && !to.startsWith(`${PREFIX}/`) && to !== PREFIX ? `${PREFIX}${to === '/' ? '' : to}` : to;
  if (to && typeof to === 'object' && typeof to.pathname === 'string') return { ...to, pathname: withPrefix(to.pathname) };
  return to;
};

export const Link = forwardRef(function Link({ to, ...rest }, ref) {
  return <RR.Link ref={ref} to={withPrefix(to)} {...rest} />;
});

export function useNavigate() {
  const nav = RR.useNavigate();
  return useCallback((to, opts) => nav(typeof to === 'number' ? to : withPrefix(to), opts), [nav]);
}

export function useLocation() {
  const loc = RR.useLocation();
  const p = loc.pathname.startsWith(PREFIX) ? loc.pathname.slice(PREFIX.length) || '/' : loc.pathname;
  return { ...loc, pathname: p };
}

export const { Route, Routes, useParams, useSearchParams } = RR;
