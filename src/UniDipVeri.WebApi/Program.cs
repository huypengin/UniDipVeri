using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using SharpGrip.FluentValidation.AutoValidation.Mvc.Extensions;
using UniDipVeri.Application;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure;
using UniDipVeri.WebApi.Authorization;

public partial class Program
{
    private static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services
        builder.Services.AddControllers();
        builder.Services.AddFluentValidationAutoValidation(configuration =>
        {
            configuration.OverrideDefaultResultFactoryWith<UniDipVeri.WebApi.Filters.ValidationResultFactory>();
        });
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen();

        // Authentication via HttpOnly Cookies
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = "UniDipVeri.Session";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.ExpireTimeSpan = TimeSpan.FromHours(24);
                options.SlidingExpiration = true;
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
                options.Events.OnValidatePrincipal = async context =>
                {
                    var principal = context.Principal;
                    var userIdStr = principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                    var userType = principal?.FindFirst("user_type")?.Value;
                    var securityStamp = principal?.FindFirst("security_stamp")?.Value;

                    if (string.IsNullOrEmpty(userIdStr) || string.IsNullOrEmpty(userType) || string.IsNullOrEmpty(securityStamp) || !Guid.TryParse(userIdStr, out var userId))
                    {
                        context.RejectPrincipal();
                        return;
                    }

                    var authService = context.HttpContext.RequestServices.GetRequiredService<UniDipVeri.Application.Features.Auth.Abstractions.IAuthService>();
                    var isValid = await authService.ValidateSecurityStampAsync(userId, userType, securityStamp, context.HttpContext.RequestAborted);
                    if (!isValid)
                    {
                        context.RejectPrincipal();
                    }
                };
            });

        builder.Services.AddAuthorization(options =>
        {
            options.AddPolicy(AuthorizationPolicies.SameStudent, policy =>
                policy.Requirements.Add(new SameStudentRequirement()));

            options.AddPolicy(AuthorizationPolicies.SameStudentOrRegistrar, policy =>
                policy.Requirements.Add(new SameStudentRequirement(StaffRole.REGISTRAR)));
        });
        builder.Services.AddSingleton<IAuthorizationHandler, SameStudentHandler>();

        // Configuration Options
        builder.Services.Configure<UniDipVeri.Application.Configurations.ApprovalPolicyOptions>(
            builder.Configuration.GetSection(UniDipVeri.Application.Configurations.ApprovalPolicyOptions.SectionName));

        // Application & Infrastructure Layers
        builder.Services.AddApplication();
        builder.Services.AddInfrastructure(builder.Configuration);

        var app = builder.Build();

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI();
        }

        app.UseHttpsRedirection();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();

        app.Run();
    }
}
