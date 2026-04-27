/* eslint-disable */
// @ts-nocheck
// This file was manually updated to include auth/callback route.

import { Route as rootRouteImport } from './routes/__root'
import { Route as AppRouteImport } from './routes/app'
import { Route as IndexRouteImport } from './routes/index'
import { Route as AuthCallbackRouteImport } from './routes/auth/callback'

const AppRoute = AppRouteImport.update({
  id: '/app', path: '/app',
  getParentRoute: () => rootRouteImport,
} as any)

const IndexRoute = IndexRouteImport.update({
  id: '/', path: '/',
  getParentRoute: () => rootRouteImport,
} as any)

const AuthCallbackRoute = AuthCallbackRouteImport.update({
  id: '/auth/callback', path: '/auth/callback',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/app': typeof AppRoute
  '/auth/callback': typeof AuthCallbackRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/app': typeof AppRoute
  '/auth/callback': typeof AuthCallbackRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/app': typeof AppRoute
  '/auth/callback': typeof AuthCallbackRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/app' | '/auth/callback'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/app' | '/auth/callback'
  id: '__root__' | '/' | '/app' | '/auth/callback'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  AppRoute: typeof AppRoute
  AuthCallbackRoute: typeof AuthCallbackRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/app': { id: '/app'; path: '/app'; fullPath: '/app'; preLoaderRoute: typeof AppRouteImport; parentRoute: typeof rootRouteImport }
    '/': { id: '/'; path: '/'; fullPath: '/'; preLoaderRoute: typeof IndexRouteImport; parentRoute: typeof rootRouteImport }
    '/auth/callback': { id: '/auth/callback'; path: '/auth/callback'; fullPath: '/auth/callback'; preLoaderRoute: typeof AuthCallbackRouteImport; parentRoute: typeof rootRouteImport }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  AppRoute: AppRoute,
  AuthCallbackRoute: AuthCallbackRoute,
}

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router.tsx'
import type { createStart } from '@tanstack/react-start'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
