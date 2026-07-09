using System.Collections.Concurrent;

namespace StandaloneBridge.ComBridge;

/// <summary>
/// CZKEM is an STA-apartment ActiveX control. Every call into it must happen
/// on the same dedicated STA thread for the lifetime of the process, or COM
/// throws RPC_E_WRONG_THREAD. This owns that thread and a work queue.
/// </summary>
public sealed class StaDispatcher : IDisposable
{
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _thread;

    public StaDispatcher()
    {
        _thread = new Thread(RunLoop)
        {
            IsBackground = true,
            Name = "ZkComStaThread",
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    private void RunLoop()
    {
        foreach (var action in _queue.GetConsumingEnumerable())
        {
            action();
        }
    }

    public Task<T> InvokeAsync<T>(Func<T> work)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add(() =>
        {
            try
            {
                tcs.SetResult(work());
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        });
        return tcs.Task;
    }

    public Task InvokeAsync(Action work) => InvokeAsync<object?>(() =>
    {
        work();
        return null;
    });

    public void Dispose()
    {
        _queue.CompleteAdding();
    }
}
