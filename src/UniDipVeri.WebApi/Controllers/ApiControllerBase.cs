using Microsoft.AspNetCore.Mvc;
using UniDipVeri.WebApi.Extensions;

namespace UniDipVeri.WebApi.Controllers;

[ApiController]
public abstract class ApiControllerBase : ControllerBase
{
    protected IActionResult MapErrorResult(Enum errorType, string? error) =>
        ControllerExtensions.MapErrorResult(this, errorType, error);
}
