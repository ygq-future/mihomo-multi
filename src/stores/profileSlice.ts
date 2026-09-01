import type { StateCreator } from 'zustand'
import * as api from '../services/tauri'
import type { ProfileItem, ProxyNode } from '../types'

export interface ProfileSlice {
  profiles: ProfileItem[]
  selectedProfileId: string | null
  profileNodes: Record<string, ProxyNode[]>
  profileLoading: boolean
  updatingProfileIds: Record<string, boolean>

  fetchProfiles: () => Promise<void>
  addRemoteProfile: (
    name: string,
    url: string,
    intervalMins: number,
  ) => Promise<ProfileItem>
  addLocalProfile: (name: string, filePath: string) => Promise<ProfileItem>
  updateProfile: (id: string) => Promise<ProfileItem>
  editProfile: (
    id: string,
    name: string,
    url: string | undefined,
    intervalMins: number,
  ) => Promise<ProfileItem>
  deleteProfile: (id: string) => Promise<void>
  fetchProfileNodes: (profileId: string) => Promise<ProxyNode[]>
  setSelectedProfileId: (id: string | null) => void
  openAppDataDir: () => Promise<void>
  openFileInFolder: (filePath: string) => Promise<void>
}

export const createProfileSlice: StateCreator<
  ProfileSlice,
  [],
  [],
  ProfileSlice
> = (set, get) => ({
  profiles: [],
  selectedProfileId: null,
  profileNodes: {},
  profileLoading: false,
  updatingProfileIds: {},

  fetchProfiles: async () => {
    set({ profileLoading: true })
    try {
      const profiles = await api.getProfiles()
      set({ profiles, profileLoading: false })
    } catch {
      set({ profileLoading: false })
    }
  },

  addRemoteProfile: async (name, url, intervalMins) => {
    set({ profileLoading: true })
    try {
      const item = await api.addRemoteProfile(name, url, intervalMins)
      set((state) => ({
        profiles: [...state.profiles, item],
        profileLoading: false,
      }))
      return item
    } catch (err) {
      set({ profileLoading: false })
      throw err
    }
  },

  addLocalProfile: async (name, filePath) => {
    set({ profileLoading: true })
    try {
      const item = await api.addLocalProfile(name, filePath)
      set((state) => ({
        profiles: [...state.profiles, item],
        profileLoading: false,
      }))
      return item
    } catch (err) {
      set({ profileLoading: false })
      throw err
    }
  },

  updateProfile: async (id) => {
    set((state) => ({
      updatingProfileIds: { ...state.updatingProfileIds, [id]: true },
    }))
    try {
      const updated = await api.updateProfile(id)
      set((state) => ({
        profiles: state.profiles.map((p) => (p.id === id ? updated : p)),
        updatingProfileIds: { ...state.updatingProfileIds, [id]: false },
      }))
      // Invalidate cached nodes
      get()
        .fetchProfileNodes(id)
        .catch(() => {})
      return updated
    } catch (err) {
      set((state) => ({
        updatingProfileIds: { ...state.updatingProfileIds, [id]: false },
      }))
      throw err
    }
  },

  editProfile: async (id, name, url, intervalMins) => {
    set({ profileLoading: true })
    try {
      const updated = await api.editProfile(id, name, url, intervalMins)
      set((state) => ({
        profiles: state.profiles.map((p) => (p.id === id ? updated : p)),
        profileLoading: false,
      }))
      return updated
    } catch (err) {
      set({ profileLoading: false })
      throw err
    }
  },

  deleteProfile: async (id) => {
    set({ profileLoading: true })
    try {
      await api.deleteProfile(id)
      set((state) => {
        const nextNodes = { ...state.profileNodes }
        delete nextNodes[id]
        return {
          profiles: state.profiles.filter((p) => p.id !== id),
          selectedProfileId:
            state.selectedProfileId === id ? null : state.selectedProfileId,
          profileNodes: nextNodes,
          profileLoading: false,
        }
      })
    } catch (err) {
      set({ profileLoading: false })
      throw err
    }
  },

  fetchProfileNodes: async (profileId) => {
    const nodes = await api.getProfileNodes(profileId)
    set((state) => ({
      profileNodes: {
        ...state.profileNodes,
        [profileId]: nodes,
      },
    }))
    return nodes
  },

  setSelectedProfileId: (selectedProfileId) => set({ selectedProfileId }),

  openAppDataDir: async () => {
    await api.openAppDataDir()
  },

  openFileInFolder: async (filePath) => {
    await api.openFileInFolder(filePath)
  },
})
