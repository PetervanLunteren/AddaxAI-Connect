/**
 * Plan or edit service tasks, shared by every page that opens
 * PlanServiceDialog (Service, Cameras, Sites), so the call, the cache
 * refresh and the messages are the same everywhere.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceApi, serviceKeys, type TaskFields } from '../../api/service';
import { useToast } from '../ui/Toaster';

interface PlanVariables {
  /** Set to edit that task; the camera ids are then ignored. */
  taskId?: number;
  cameraIds: number[];
  fields: TaskFields;
}

export function usePlanService(projectId: number, onSuccess: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ taskId, cameraIds, fields }: PlanVariables) =>
      taskId !== undefined
        ? serviceApi.updateTask(projectId, taskId, fields)
        : serviceApi.planTasks(projectId, cameraIds, fields),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.tasks(projectId) });
      toast.success(taskId !== undefined ? 'Task saved' : 'Service planned');
      onSuccess();
    },
    onError: (error: any) =>
      toast.error(`Could not save the task. ${error?.response?.data?.detail || error?.message}`),
  });
}
