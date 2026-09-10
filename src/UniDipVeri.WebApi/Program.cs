using Microsoft.AspNetCore.Authentication.Cookies;
using UniDipVeri.Application;
using UniDipVeri.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
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

builder.Services.AddAuthorization();

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
