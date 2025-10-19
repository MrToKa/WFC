import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type Project,
  createProject,
  deleteProject,
  fetchProjects,
  updateProject
} from '@/api/client';

import {
  PROJECTS_PER_PAGE,
  emptyProjectForm,
  parseProjectApiErrors,
  type ProjectFormErrors,
  type ProjectFormState
} from '../AdminPanel.utils';

type UseAdminProjectsSectionParams = {
  token: string | null;
};

export type AdminProjectsSectionState = {
  projectsLoading: boolean;
  projectsRefreshing: boolean;
  projectsError: string | null;
  pagedProjects: Project[];
  projectSearch: string;
  setProjectSearch: (value: string) => void;
  projectPage: number;
  setProjectPage: (value: number | ((previous: number) => number)) => void;
  totalProjectPages: number;
  projectSortIndicator: (field: ProjectSortField) => string;
  toggleProjectSort: (field: ProjectSortField) => void;
  loadProjects: (options?: { showSpinner?: boolean }) => Promise<void>;
  createProjectDialogOpen: boolean;
  setCreateProjectDialogOpen: (value: boolean) => void;
  createProjectValues: ProjectFormState;
  createProjectErrors: ProjectFormErrors;
  creatingProject: boolean;
  projectActionMessage: string | null;
  projectActionError: string | null;
  handleCreateProjectFieldChange: (
    field: keyof ProjectFormState
  ) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    data: { value: string }
  ) => void;
  handleSubmitCreateProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  editingProjectId: string | null;
  editingProject: Project | null;
  projectEditValues: ProjectFormState;
  projectEditErrors: ProjectFormErrors;
  projectEditSuccess: string | null;
  projectSaving: boolean;
  handleStartEditProject: (project: Project) => void;
  handleCancelEditProject: () => void;
  handleEditProjectFieldChange: (
    field: keyof ProjectFormState
  ) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    data: { value: string }
  ) => void;
  handleSubmitEditProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteProject: (projectId: string) => Promise<void>;
  pendingProjectAction: string | null;
};

type ProjectSortField =
  | 'projectNumber'
  | 'name'
  | 'customer'
  | 'manager'
  | 'createdAt'
  | 'updatedAt';

export const useAdminProjectsSection = ({
  token
}: UseAdminProjectsSectionParams): AdminProjectsSectionState => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState<boolean>(true);
  const [projectsRefreshing, setProjectsRefreshing] = useState<boolean>(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [projectSearch, setProjectSearch] = useState<string>('');
  const [projectSortField, setProjectSortField] =
    useState<ProjectSortField>('createdAt');
  const [projectSortDirection, setProjectSortDirection] =
    useState<'asc' | 'desc'>('desc');
  const [projectPage, setProjectPageState] = useState<number>(1);

  const [createProjectDialogOpen, setCreateProjectDialogOpenState] =
    useState<boolean>(false);
  const [createProjectValues, setCreateProjectValues] =
    useState<ProjectFormState>(emptyProjectForm);
  const [createProjectErrors, setCreateProjectErrors] =
    useState<ProjectFormErrors>({});
  const [creatingProject, setCreatingProject] = useState<boolean>(false);
  const [projectActionMessage, setProjectActionMessage] =
    useState<string | null>(null);
  const [projectActionError, setProjectActionError] =
    useState<string | null>(null);

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectEditValues, setProjectEditValues] =
    useState<ProjectFormState>(emptyProjectForm);
  const [projectEditErrors, setProjectEditErrors] =
    useState<ProjectFormErrors>({});
  const [projectEditSuccess, setProjectEditSuccess] =
    useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState<boolean>(false);
  const [pendingProjectAction, setPendingProjectAction] =
    useState<string | null>(null);

  const loadProjects = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
      if (showSpinner) {
        setProjectsLoading(true);
      } else {
        setProjectsRefreshing(true);
      }
      setProjectsError(null);

      try {
        const response = await fetchProjects();
        setProjects(response.projects);
      } catch (error) {
        console.error('Failed to fetch projects', error);
        const message =
          error instanceof ApiError ? error.message : 'Failed to fetch projects.';
        setProjectsError(message);
      } finally {
        setProjectsLoading(false);
        setProjectsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadProjects({ showSpinner: true });
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    const list = term
      ? projects.filter((project) => {
          const managerValue = project.manager?.toLowerCase() ?? '';
          return (
            project.projectNumber.toLowerCase().includes(term) ||
            project.name.toLowerCase().includes(term) ||
            project.customer.toLowerCase().includes(term) ||
            managerValue.includes(term)
          );
        })
      : [...projects];

    const direction = projectSortDirection === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      switch (projectSortField) {
        case 'projectNumber':
          return a.projectNumber.localeCompare(b.projectNumber) * direction;
        case 'name':
          return a.name.localeCompare(b.name) * direction;
        case 'customer':
          return a.customer.localeCompare(b.customer) * direction;
        case 'manager': {
          const managerA = a.manager ?? '';
          const managerB = b.manager ?? '';
          return managerA.localeCompare(managerB) * direction;
        }
        case 'updatedAt':
          return (
            (new Date(a.updatedAt).getTime() -
              new Date(b.updatedAt).getTime()) * direction
          );
        case 'createdAt':
        default:
          return (
            (new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()) * direction
          );
      }
    });
  }, [projects, projectSearch, projectSortDirection, projectSortField]);

  const totalProjectPages = useMemo(
    () => Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE)),
    [filteredProjects.length]
  );

  useEffect(() => {
    if (projectPage > totalProjectPages) {
      setProjectPageState(totalProjectPages);
    }
  }, [totalProjectPages, projectPage]);

  useEffect(() => {
    setProjectPageState(1);
  }, [projectSearch, projectSortField, projectSortDirection]);

  const pagedProjects = useMemo(() => {
    const start = (projectPage - 1) * PROJECTS_PER_PAGE;
    return filteredProjects.slice(start, start + PROJECTS_PER_PAGE);
  }, [filteredProjects, projectPage]);

  const toggleProjectSort = (field: ProjectSortField) => {
    if (projectSortField === field) {
      setProjectSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setProjectSortField(field);
    setProjectSortDirection('asc');
  };

  const projectSortIndicator = (field: ProjectSortField): string =>
    projectSortField === field
      ? projectSortDirection === 'asc'
        ? ' ↑'
        : ' ↓'
      : '';

  const handleCreateProjectFieldChange =
    (field: keyof ProjectFormState) =>
    (
      _event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      data: { value: string }
    ) => {
      setCreateProjectValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
      setCreateProjectErrors((previous) => ({
        ...previous,
        [field]: undefined,
        general: undefined
      }));
      setProjectActionMessage(null);
      setProjectActionError(null);
    };

  const handleSubmitCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      setProjectActionError('Authentication token is missing.');
      return;
    }

    const payload = {
      projectNumber: createProjectValues.projectNumber.trim(),
      name: createProjectValues.name.trim(),
      customer: createProjectValues.customer.trim(),
      manager: createProjectValues.manager.trim(),
      description: createProjectValues.description.trim()
    };

    const errors: ProjectFormErrors = {};

    if (!payload.projectNumber) {
      errors.projectNumber = 'Project number is required.';
    }
    if (!payload.name) {
      errors.name = 'Project name is required.';
    }
    if (!payload.customer) {
      errors.customer = 'Customer is required.';
    }

    if (Object.keys(errors).length > 0) {
      setCreateProjectErrors(errors);
      return;
    }

    setCreatingProject(true);
    setCreateProjectErrors({});

    try {
      const response = await createProject(token, {
        projectNumber: payload.projectNumber,
        name: payload.name,
        customer: payload.customer,
        manager: payload.manager || undefined,
        description: payload.description || undefined
      });
      setProjects((previous) => [response.project, ...previous]);
      setCreateProjectValues(emptyProjectForm);
      setProjectActionMessage('Project created successfully.');
      setProjectActionError(null);
      setProjectPageState(1);
      setCreateProjectDialogOpenState(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setCreateProjectErrors(parseProjectApiErrors(error.payload));
      } else {
        setCreateProjectErrors({
          general: 'Failed to create project. Please try again.'
        });
      }
    } finally {
      setCreatingProject(false);
    }
  };

  const handleStartEditProject = (projectToEdit: Project) => {
    setEditingProjectId(projectToEdit.id);
    setProjectEditValues({
      projectNumber: projectToEdit.projectNumber,
      name: projectToEdit.name,
      customer: projectToEdit.customer,
      manager: projectToEdit.manager ?? '',
      description: projectToEdit.description ?? ''
    });
    setProjectEditErrors({});
    setProjectEditSuccess(null);
    setProjectActionMessage(null);
    setProjectActionError(null);
  };

  const handleCancelEditProject = () => {
    setEditingProjectId(null);
    setProjectEditValues(emptyProjectForm);
    setProjectEditErrors({});
    setProjectEditSuccess(null);
  };

  const editingProject = useMemo(
    () => projects.find((candidate) => candidate.id === editingProjectId) ?? null,
    [projects, editingProjectId]
  );

  const handleEditProjectFieldChange =
    (field: keyof ProjectFormState) =>
    (
      _event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      data: { value: string }
    ) => {
      setProjectEditValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
      setProjectEditErrors((previous) => ({
        ...previous,
        [field]: undefined,
        general: undefined
      }));
      setProjectEditSuccess(null);
    };

  const handleSubmitEditProject = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!token || !editingProjectId || !editingProject) {
      return;
    }

    const payload: {
      projectNumber?: string;
      name?: string;
      customer?: string;
      manager?: string | null;
      description?: string;
    } = {};

    const projectNumberValue = projectEditValues.projectNumber.trim();
    if (projectNumberValue !== editingProject.projectNumber) {
      payload.projectNumber = projectNumberValue;
    }

    const nameValue = projectEditValues.name.trim();
    if (nameValue !== editingProject.name) {
      payload.name = nameValue;
    }

    const customerValue = projectEditValues.customer.trim();
    if (customerValue !== editingProject.customer) {
      payload.customer = customerValue;
    }

    const managerValue = projectEditValues.manager.trim();
    if (managerValue !== (editingProject.manager ?? '')) {
      payload.manager = managerValue || '';
    }

    const descriptionValue = projectEditValues.description.trim();
    if (descriptionValue !== (editingProject.description ?? '')) {
      payload.description = descriptionValue || '';
    }

    if (Object.keys(payload).length === 0) {
      setProjectEditErrors({
        general: 'Update at least one field before saving.'
      });
      return;
    }

    setProjectSaving(true);
    setProjectEditErrors({});
    setProjectEditSuccess(null);

    try {
      const response = await updateProject(token, editingProjectId, payload);
      setProjects((previous) =>
        previous.map((candidate) =>
          candidate.id === editingProjectId ? response.project : candidate
        )
      );
      setProjectEditSuccess('Project updated successfully.');
      setProjectActionMessage('Project details updated.');
      setProjectActionError(null);
      setEditingProjectId(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setProjectEditErrors(parseProjectApiErrors(error.payload));
      } else {
        setProjectEditErrors({
          general: 'Failed to update project. Please try again.'
        });
      }
    } finally {
      setProjectSaving(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!token) {
      return;
    }

    if (!window.confirm('This will permanently delete the project. Continue?')) {
      return;
    }

    setPendingProjectAction(projectId);
    setProjectActionError(null);
    setProjectActionMessage(null);

    try {
      await deleteProject(token, projectId);
      setProjects((previous) =>
        previous.filter((candidate) => candidate.id !== projectId)
      );
      if (editingProjectId === projectId) {
        handleCancelEditProject();
      }
      setProjectActionMessage('Project deleted successfully.');
    } catch (error) {
      console.error('Failed to delete project', error);
      const message =
        error instanceof ApiError ? error.message : 'Failed to delete project.';
      setProjectActionError(message);
    } finally {
      setPendingProjectAction(null);
    }
  };

  return {
    projectsLoading,
    projectsRefreshing,
    projectsError,
    pagedProjects,
    projectSearch,
    setProjectSearch,
    projectPage,
    setProjectPage: (value) => {
      setProjectPageState((previous) =>
        typeof value === 'function' ? (value as (p: number) => number)(previous) : value
      );
    },
    totalProjectPages,
    projectSortIndicator,
    toggleProjectSort,
    loadProjects,
    createProjectDialogOpen,
    setCreateProjectDialogOpen: (value) => {
      setCreateProjectDialogOpenState(value);
      if (!value) {
        setCreateProjectErrors({});
        setCreateProjectValues(emptyProjectForm);
      }
    },
    createProjectValues,
    createProjectErrors,
    creatingProject,
    projectActionMessage,
    projectActionError,
    handleCreateProjectFieldChange,
    handleSubmitCreateProject,
    editingProjectId,
    editingProject,
    projectEditValues,
    projectEditErrors,
    projectEditSuccess,
    projectSaving,
    handleStartEditProject,
    handleCancelEditProject,
    handleEditProjectFieldChange,
    handleSubmitEditProject,
    handleDeleteProject,
    pendingProjectAction
  };
};
