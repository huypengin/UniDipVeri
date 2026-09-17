using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SharpGrip.FluentValidation.AutoValidation.Mvc.Results;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.WebApi.Filters;

public class ValidationResultFactory : IFluentValidationAutoValidationResultFactory
{
    public Task<IActionResult?> CreateActionResult(
        ActionExecutingContext context,
        ValidationProblemDetails? validationProblemDetails,
        IDictionary<IValidationContext, ValidationResult>? validationResults)
    {
        var actionName = context.ActionDescriptor.RouteValues["action"];
        bool isLogin = string.Equals(actionName, "Login", StringComparison.OrdinalIgnoreCase) ||
                       (validationResults?.Keys.Any(k => k.InstanceToValidate is LoginRequest) ?? false);

        if (isLogin)
        {
            return Task.FromResult<IActionResult?>(new UnauthorizedObjectResult(new { message = "Invalid email or password." }));
        }

        var firstError = validationResults?.Values
            .SelectMany(r => r.Errors)
            .FirstOrDefault()?.ErrorMessage
            ?? validationProblemDetails?.Errors.Values.FirstOrDefault()?.FirstOrDefault()
            ?? "Validation failed.";

        return Task.FromResult<IActionResult?>(new BadRequestObjectResult(new
        {
            message = firstError,
            errors = validationProblemDetails?.Errors
        }));
    }
}
